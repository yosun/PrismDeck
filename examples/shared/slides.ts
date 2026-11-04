export type Slide = {
  id: string;
  index: number;
  title: string;
  category: string;
  colors: readonly [string, string, string];
};

const studies = [
  { title: 'Contours of tomorrow', category: 'FORM & SPACE', colors: ['#f5f5f5', '#a3a3a3', '#242424'] },
  { title: 'A quieter frequency', category: 'LIGHT & RHYTHM', colors: ['#ededed', '#909090', '#303030'] },
  { title: 'Between the blue', category: 'TONE & DEPTH', colors: ['#ffffff', '#b5b5b5', '#414141'] },
  { title: 'The shape of motion', category: 'MOVEMENT & MATTER', colors: ['#e5e5e5', '#8a8a8a', '#222222'] },
  { title: 'An open horizon', category: 'LAND & POSSIBILITY', colors: ['#fafafa', '#aaaaaa', '#383838'] },
] as const;

export function collection(count: number): Slide[] {
  return Array.from({ length: count }, (_, index) => ({ ...studies[index % studies.length], index, id: `study-${index}` }));
}

/** Local, lazy 16:9 previews align exactly with the default pane boundaries. */
export function imageSource(slide: Slide): string {
  const [light, mid, dark] = slide.colors;
  const offset = (slide.index % 7) * 22;
  const xmlEntities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
  const xmlText = (value: string) => value.replace(/[&<>"']/g, (character) => xmlEntities[character]);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="${light}"/><stop offset="1" stop-color="${mid}"/></linearGradient><linearGradient id="hill" x2="0" y2="1"><stop stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs><rect width="1600" height="900" fill="url(#bg)"/><circle cx="${1240 - offset}" cy="${290 + offset / 2}" r="180" fill="${light}" opacity=".75"/><path d="M0 630 Q360 ${180 + offset} 790 590 T1600 450 V900 H0Z" fill="url(#hill)"/><path d="M0 780 Q480 ${390 - offset} 1040 750 T1600 660 V900 H0Z" fill="${dark}" opacity=".86"/><path d="M0 655 Q370 ${205 + offset} 790 614 T1600 477" fill="none" stroke="${light}" stroke-width="2" opacity=".45"/><g fill="${dark}" font-family="Arial,Helvetica,sans-serif"><text x="76" y="88" font-size="19" letter-spacing="5">STUDIES IN PERSPECTIVE</text><text x="76" y="215" font-size="68" font-weight="500">${xmlText(slide.title)}</text><text x="78" y="265" font-size="20" letter-spacing="3">${xmlText(slide.category)}</text></g><text x="76" y="836" fill="${light}" font-family="Arial,Helvetica,sans-serif" font-size="21" letter-spacing="2">PRISMDECK / ${String(slide.index + 1).padStart(3, '0')}</text><path d="M1446 777h70m-24-24 24 24-24 24" stroke="${light}" stroke-width="3" fill="none"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
