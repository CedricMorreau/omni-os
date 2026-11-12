export const speakable = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, 'Code block.')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*(#{1,6}|[-*+]|\d+\.|>)\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .trim();

export function speak(text: string, onEnd: () => void) {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(speakable(text));
  u.onend = u.onerror = onEnd;
  speechSynthesis.speak(u);
}
