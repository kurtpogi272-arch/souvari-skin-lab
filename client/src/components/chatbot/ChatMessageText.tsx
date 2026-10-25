/** Render plain text and safe web links; never interpret model output as HTML. */
function linkLabel(url: string): string {
  try {
    const parsed = new URL(url);
    if (['www.google.com', 'google.com'].includes(parsed.hostname) && parsed.pathname.startsWith('/maps/')) return 'Open Google Maps';
  } catch { /* Keep malformed URLs as their original text. */ }
  return url;
}

export default function ChatMessageText({ text }: { text: string }) {
  return <p className="whitespace-pre-wrap break-words">{text.split(/(https?:\/\/[^\s]+)/g).map((part, index) =>
    /^https?:\/\//.test(part)
      ? <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="underline break-all">{linkLabel(part)}</a>
      : part,
  )}</p>;
}
