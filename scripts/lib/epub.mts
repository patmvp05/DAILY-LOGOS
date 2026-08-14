/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Minimal, deterministic EPUB 3 writer.
 *
 * Hand-rolled on top of jszip rather than a generator library because the two
 * things that matter here are things generators hide: full control of the e-ink
 * stylesheet, and byte-for-byte reproducible output. A daily job that produced a
 * different file from identical inputs would be impossible to diff or verify.
 *
 * Determinism comes from never reading the clock: every zip entry gets the same
 * fixed timestamp, `createFolders: false` suppresses implicitly-dated directory
 * entries, and `dcterms:modified` is passed in by the caller. Same inputs in →
 * identical bytes out.
 *
 * Also emits a legacy toc.ncx alongside the EPUB 3 nav document. It is not
 * required by EPUB 3, but reMarkable's reader is closed-source and cheap
 * insurance beats a pack that opens with no table of contents.
 */
import JSZip from 'jszip';

/** Fixed zip entry timestamp. Any constant works; this one is just the epoch. */
const FIXED_DATE = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

export const EPUB_MIMETYPE = 'application/epub+zip';

/** Directory inside the archive holding all content documents. */
const OEBPS = 'OEBPS';

export interface EpubSection {
  /** Manifest id and `.xhtml` base name. Must be unique and XML-name-safe. */
  id: string;
  /** Table-of-contents label. Omit to keep the section out of the TOC. */
  title?: string;
  /** Complete XHTML document text (build it with {@link xhtmlDocument}). */
  xhtml: string;
  /** TOC depth: 1 = top level, 2 = nested under the preceding level-1 entry. */
  navLevel?: 1 | 2;
}

export interface EpubInput {
  /** dc:title — what the device shows in the library. */
  title: string;
  author: string;
  /** dc:identifier. Must be stable for a given logical document. */
  identifier: string;
  /**
   * dcterms:modified, `YYYY-MM-DDTHH:MM:SSZ`. Required by EPUB 3 and passed in
   * (never `new Date()`) so output stays reproducible.
   */
  modified: string;
  language?: string;
  /** Contents of `style.css`, shared by every section. */
  css: string;
  sections: EpubSection[];
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Wrap body markup in a valid XHTML5 document linked to the shared stylesheet. */
export function xhtmlDocument(title: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head>
<meta charset="utf-8"/>
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${body}
</body>
</html>
`;
}

/**
 * Nested `<ol>` for nav.xhtml.
 *
 * EPUB 3 requires a level-2 list to live *inside* its parent `<li>`, so this
 * cannot be a flat map — it tracks whether a sublist is open and closes it
 * before the next top-level item.
 */
function buildNavList(sections: EpubSection[]): string {
  const listed = sections.filter((s) => s.title);
  const out: string[] = ['<ol>'];
  let subOpen = false;
  let itemOpen = false;

  for (const s of listed) {
    const link = `<a href="${s.id}.xhtml">${escapeXml(s.title!)}</a>`;
    if ((s.navLevel ?? 1) === 2) {
      // A level-2 entry with no level-1 parent would be invalid; promote it.
      if (!itemOpen) {
        out.push(`<li>${link}`);
        itemOpen = true;
        continue;
      }
      if (!subOpen) { out.push('<ol>'); subOpen = true; }
      out.push(`<li>${link}</li>`);
    } else {
      if (subOpen) { out.push('</ol>'); subOpen = false; }
      if (itemOpen) { out.push('</li>'); }
      out.push(`<li>${link}`);
      itemOpen = true;
    }
  }
  if (subOpen) out.push('</ol>');
  if (itemOpen) out.push('</li>');
  out.push('</ol>');
  return out.join('\n');
}

function buildNav(input: EpubInput): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head>
<meta charset="utf-8"/>
<title>Contents</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
<nav epub:type="toc" id="toc">
<h1>Contents</h1>
${buildNavList(input.sections)}
</nav>
</body>
</html>
`;
}

/** EPUB 2 fallback TOC. Flat on purpose — depth adds nothing for this pack. */
function buildNcx(input: EpubInput): string {
  const points = input.sections
    .filter((s) => s.title)
    .map((s, i) => `<navPoint id="nav-${s.id}" playOrder="${i + 1}">
<navLabel><text>${escapeXml(s.title!)}</text></navLabel>
<content src="${s.id}.xhtml"/>
</navPoint>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head>
<meta name="dtb:uid" content="${escapeXml(input.identifier)}"/>
<meta name="dtb:depth" content="1"/>
<meta name="dtb:totalPageCount" content="0"/>
<meta name="dtb:maxPageNumber" content="0"/>
</head>
<docTitle><text>${escapeXml(input.title)}</text></docTitle>
<navMap>
${points}
</navMap>
</ncx>
`;
}

function buildOpf(input: EpubInput): string {
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    ...input.sections.map(
      (s) => `<item id="${s.id}" href="${s.id}.xhtml" media-type="application/xhtml+xml"/>`
    ),
  ].join('\n');

  const spine = input.sections.map((s) => `<itemref idref="${s.id}"/>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="en">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="pub-id">${escapeXml(input.identifier)}</dc:identifier>
<dc:title>${escapeXml(input.title)}</dc:title>
<dc:creator>${escapeXml(input.author)}</dc:creator>
<dc:language>${escapeXml(input.language ?? 'en')}</dc:language>
<meta property="dcterms:modified">${escapeXml(input.modified)}</meta>
</metadata>
<manifest>
${manifest}
</manifest>
<spine toc="ncx">
${spine}
</spine>
</package>
`;
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
<rootfiles>
<rootfile full-path="${OEBPS}/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>
`;

/** Assemble the archive. Returns the raw `.epub` bytes. */
export async function buildEpub(input: EpubInput): Promise<Buffer> {
  if (input.sections.length === 0) throw new Error('buildEpub: spine would be empty');
  const ids = new Set<string>();
  for (const s of input.sections) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(s.id)) {
      throw new Error(`buildEpub: section id "${s.id}" is not a safe XML name`);
    }
    if (ids.has(s.id)) throw new Error(`buildEpub: duplicate section id "${s.id}"`);
    ids.add(s.id);
  }

  const zip = new JSZip();
  const opts = { date: FIXED_DATE, createFolders: false } as const;

  // mimetype MUST be the first entry and MUST be stored uncompressed.
  zip.file('mimetype', EPUB_MIMETYPE, { ...opts, compression: 'STORE' });
  zip.file('META-INF/container.xml', CONTAINER_XML, opts);
  zip.file(`${OEBPS}/content.opf`, buildOpf(input), opts);
  zip.file(`${OEBPS}/nav.xhtml`, buildNav(input), opts);
  zip.file(`${OEBPS}/toc.ncx`, buildNcx(input), opts);
  zip.file(`${OEBPS}/style.css`, input.css, opts);
  for (const s of input.sections) {
    zip.file(`${OEBPS}/${s.id}.xhtml`, s.xhtml, opts);
  }

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    // Fixed metadata keeps the archive reproducible.
    platform: 'UNIX',
    streamFiles: false,
  });
}

/**
 * Structural check on a built `.epub`.
 *
 * Shared by the offline test and the CI upload gate so a malformed pack can
 * never reach the device: one implementation, one set of rules. Returns a list
 * of problems — empty means valid.
 */
export async function validateEpub(buffer: Uint8Array): Promise<string[]> {
  const problems: string[] = [];

  // The mimetype rule is about raw byte layout, which jszip abstracts away, so
  // read the first local file header directly.
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (buffer.byteLength < 38) {
    problems.push('file is too short to be a zip');
    return problems;
  }
  if (view.getUint32(0, true) !== 0x04034b50) {
    problems.push('does not start with a zip local file header');
    return problems;
  }
  const method = view.getUint16(8, true);
  const nameLen = view.getUint16(26, true);
  const extraLen = view.getUint16(28, true);
  const compressedSize = view.getUint32(18, true);
  const firstName = Buffer.from(buffer.slice(30, 30 + nameLen)).toString('latin1');
  if (firstName !== 'mimetype') problems.push(`first zip entry is "${firstName}", not "mimetype"`);
  if (method !== 0) problems.push(`mimetype is compressed (method ${method}), must be stored`);
  if (extraLen !== 0) problems.push('mimetype entry has an extra field, must have none');
  const dataStart = 30 + nameLen + extraLen;
  const mime = Buffer.from(buffer.slice(dataStart, dataStart + compressedSize)).toString('utf8');
  if (mime !== EPUB_MIMETYPE) problems.push(`mimetype content is "${mime}"`);

  const zip = await JSZip.loadAsync(buffer);
  const has = (p: string) => !!zip.file(p);

  if (!has('META-INF/container.xml')) {
    problems.push('missing META-INF/container.xml');
    return problems;
  }
  const container = await zip.file('META-INF/container.xml')!.async('string');
  const opfPath = /full-path="([^"]+)"/.exec(container)?.[1];
  if (!opfPath) {
    problems.push('container.xml declares no rootfile full-path');
    return problems;
  }
  if (!has(opfPath)) {
    problems.push(`container.xml points at "${opfPath}", which is not in the archive`);
    return problems;
  }

  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const opf = await zip.file(opfPath)!.async('string');

  const manifest = new Map<string, string>(); // id -> href
  for (const m of opf.matchAll(/<item\b([^>]*)\/>/g)) {
    const attrs = m[1];
    const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
    const href = /\bhref="([^"]+)"/.exec(attrs)?.[1];
    if (!id || !href) { problems.push(`manifest item missing id or href: ${attrs.trim()}`); continue; }
    if (manifest.has(id)) problems.push(`duplicate manifest id "${id}"`);
    manifest.set(id, href);
    if (!has(base + href)) problems.push(`manifest item "${id}" points at missing file "${href}"`);
  }
  if (manifest.size === 0) problems.push('manifest is empty');

  const navItems = [...opf.matchAll(/<item\b[^>]*properties="[^"]*\bnav\b[^"]*"[^>]*\/>/g)];
  if (navItems.length !== 1) {
    problems.push(`expected exactly 1 nav document in the manifest, found ${navItems.length}`);
  }

  const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)].map((m) => m[1]);
  if (spine.length === 0) problems.push('spine is empty');
  for (const idref of spine) {
    if (!manifest.has(idref)) problems.push(`spine references unknown manifest id "${idref}"`);
  }

  // Every internal href/src must resolve to a real file, and any #fragment to a
  // real id inside it. A broken link is silent on-device: the tap just does
  // nothing, which is exactly the kind of thing that ships unnoticed.
  const xhtmlPaths = [...manifest.values()]
    .filter((h) => h.endsWith('.xhtml'))
    .map((h) => base + h);
  const idsByPath = new Map<string, Set<string>>();
  const textByPath = new Map<string, string>();
  for (const p of xhtmlPaths) {
    const f = zip.file(p);
    if (!f) continue;
    const text = await f.async('string');
    textByPath.set(p, text);
    idsByPath.set(p, new Set([...text.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])));
  }
  for (const [p, text] of textByPath) {
    const dir = p.slice(0, p.lastIndexOf('/') + 1);
    for (const m of text.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      const raw = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) continue; // external
      const [target, frag] = raw.split('#');
      const resolved = target === '' ? p : dir + target;
      if (target !== '' && !has(resolved)) {
        problems.push(`${p} links to missing "${raw}"`);
        continue;
      }
      if (frag && !idsByPath.get(resolved)?.has(frag)) {
        problems.push(`${p} links to "${raw}" but no element has id="${frag}"`);
      }
    }
  }

  return problems;
}
