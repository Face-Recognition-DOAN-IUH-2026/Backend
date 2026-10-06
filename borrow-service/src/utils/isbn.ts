// ISBN-10 <-> ISBN-13 conversion (checksum-based) for label/book lookups.

export function convertIsbnFormat(isbn: string): string | null {
  const clean = isbn.replace(/[\s-]/g, '');
  if (/^97[89]\d{10}$/.test(clean)) {
    const core = clean.slice(3, 12);
    let sum = 0;
    for (let i = 0; i < 9; i += 1) sum += Number(core[i]) * (10 - i);
    const check = (11 - (sum % 11)) % 11;
    return core + (check === 10 ? 'X' : String(check));
  }
  if (/^\d{9}[\dXx]$/.test(clean)) {
    const base = `978${clean.slice(0, 9)}`;
    let sum = 0;
    for (let i = 0; i < 12; i += 1) sum += Number(base[i]) * (i % 2 === 1 ? 3 : 1);
    return base + String((10 - (sum % 10)) % 10);
  }
  return null;
}
