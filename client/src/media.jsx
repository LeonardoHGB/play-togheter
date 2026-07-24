import { getServerUrl } from "./socket";

// Limite alinhado ao do servidor (MAX_UPLOAD_BYTES). Só evita subir à toa.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Miniatura: o chat mostra a imagem numa caixa de ~200px, mas sem isso o
// navegador baixa e decodifica o original inteiro (até 25 MB) só para reduzir
// na tela. Com 100 mensagens de histórico isso estoura a memória.
const THUMB_MAX_EDGE = 480;
const THUMB_QUALITY = 0.72;
const THUMB_SKIP_BELOW = 200 * 1024;

async function makeThumbnail(file) {
  // GIF fica de fora: createImageBitmap devolve só o primeiro quadro e a
  // miniatura mataria a animação.
  if (!file.type.startsWith("image/") || file.type === "image/gif") return null;
  if (file.size <= THUMB_SKIP_BELOW) return null;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }

  try {
    const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);

    return await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", THUMB_QUALITY)
    );
  } finally {
    bitmap.close?.();
  }
}

async function uploadBlob(blob, name, base, creds) {
  const response = await fetch(`${base}/upload?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "x-user-id": creds.userId,
      "x-user-token": creds.token
    },
    body: blob
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.message || "Falha ao enviar o arquivo.");
  }
  return data.attachment;
}

// Sobe o arquivo para o servidor (corpo bruto) e devolve os metadados do anexo:
// { url, name, mime, size, kind, thumbUrl? }. `creds` = { userId, token }.
export async function uploadFile(file, creds) {
  const base = getServerUrl();
  if (!base) throw new Error("Sem conexão com o servidor.");
  if (!creds?.userId || !creds?.token) {
    throw new Error("Faça login para enviar arquivos.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Arquivo muito grande (máx. 25 MB).");
  }

  const attachment = await uploadBlob(file, file.name, base, creds);

  if (attachment.kind === "image") {
    // A miniatura é otimização: se falhar, o anexo continua válido e o chat
    // cai no original.
    try {
      const thumb = await makeThumbnail(file);
      if (thumb) {
        const uploaded = await uploadBlob(thumb, "thumb.jpg", base, creds);
        attachment.thumbUrl = uploaded.url;
      }
    } catch {
      // segue sem miniatura
    }
  }

  return attachment;
}

// URL absoluta do anexo (o servidor guarda um caminho relativo /uploads/...).
export function attachmentUrl(attachment, { download } = {}) {
  const base = getServerUrl();
  const suffix = download
    ? `?name=${encodeURIComponent(attachment.name || "arquivo")}`
    : "";
  return `${base}${attachment.url}${suffix}`;
}

// Miniatura quando existe; senão o original (anexos enviados antes desta
// versão não têm thumbUrl).
export function thumbnailUrl(attachment) {
  return `${getServerUrl()}${attachment.thumbUrl || attachment.url}`;
}

// Abre o anexo fora do app: o navegador externo cuida do download/preview do
// documento. Em imagem, abre o arquivo em tamanho cheio.
export function openAttachment(attachment) {
  const url = attachmentUrl(attachment, { download: true });
  if (window.electronAPI?.openUpload) {
    window.electronAPI.openUpload(url).catch(() => {});
  } else {
    window.open(url, "_blank", "noopener");
  }
}

const FILE_EMOJI = {
  pdf: "📄", doc: "📝", docx: "📝", txt: "📄", rtf: "📝",
  csv: "📊", xls: "📊", xlsx: "📊", ppt: "📈", pptx: "📈",
  zip: "🗜️", rar: "🗜️", "7z": "🗜️"
};

function extOf(name) {
  const match = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

// Renderiza um anexo dentro de uma mensagem: imagem/vídeo/áudio inline; qualquer
// outro tipo vira um card clicável que abre/baixa o documento.
export function ChatAttachment({ attachment }) {
  if (!attachment) return null;
  const src = attachmentUrl(attachment);

  if (attachment.kind === "image") {
    return (
      <button
        type="button"
        className="attach-image"
        onClick={() => openAttachment(attachment)}
        title={attachment.name}
      >
        <img
          src={thumbnailUrl(attachment)}
          alt={attachment.name}
          referrerPolicy="no-referrer"
          loading="lazy"
          decoding="async"
        />
      </button>
    );
  }

  if (attachment.kind === "video") {
    return <video className="attach-video" src={src} controls preload="metadata" />;
  }

  if (attachment.kind === "audio") {
    return <audio className="attach-audio" src={src} controls preload="metadata" />;
  }

  return (
    <button
      type="button"
      className="attach-file"
      onClick={() => openAttachment(attachment)}
      title={`Abrir ${attachment.name}`}
    >
      <span className="attach-file-icon">{FILE_EMOJI[extOf(attachment.name)] || "📎"}</span>
      <span className="attach-file-meta">
        <strong>{attachment.name}</strong>
        <span>{formatBytes(attachment.size)}</span>
      </span>
      <span className="attach-file-dl">⭳</span>
    </button>
  );
}

// Botão de clipe: abre o seletor de arquivo e chama onPick(file).
export function AttachButton({ onPick, disabled, busy, title = "Anexar arquivo" }) {
  return (
    <label className={`attach-button ${disabled || busy ? "disabled" : ""}`} title={title}>
      <input
        type="file"
        hidden
        disabled={disabled || busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onPick(file);
        }}
      />
      <span aria-hidden="true">{busy ? "…" : "📎"}</span>
    </label>
  );
}
