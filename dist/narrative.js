// Project an authored narrative field (step titles, `why` prose, concept bodies,
// beat text) into the three forms the app consumes: sanitized HTML for the page,
// plain text for attributes and word counts, and a speech stream for the narrator.
//
// The field is authored as a small, fixed subset of HTML. This module is the only
// place that subset is defined: one tokenizer, one tree builder, one serializer.
// Every consumer projects from the same parse, so what the page shows, what an
// aria-label says, and what the narrator reads can never drift apart.
//
// The security property is structural rather than a filter: no byte of the input
// reaches the output except as escaped text or an escaped attribute value. Every
// tag and attribute in the output is emitted by the serializer from a node the
// allowlist approved, so there is no sanitized-output-reparsed gap for mXSS to
// exploit — and `serialize(parseNarrative(x))` is a fixpoint: re-parsing the
// output yields the same output again.
//
// Zero dependencies — the same trust model as the rest of the render path.
/** Inline markup: legal in every tier except `text`. */
const INLINE_ELEMENTS = new Set(['code', 'kbd', 'strong', 'em', 'sup', 'sub', 'span', 'br']);
/** Block markup: legal only in the `block` tier. */
const BLOCK_ELEMENTS = new Set([
    'p',
    'h2',
    'h3',
    'h4',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'hr',
    'table',
    'caption',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'dl',
    'dt',
    'dd',
]);
/** Allowlisted elements that never have children or an end tag. */
const VOID_ELEMENTS = new Set(['br', 'hr']);
/** Dropped along with everything inside them — the content is not narrative. */
const DROP_WITH_CONTENTS = new Set([
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'form',
    'input',
    'textarea',
    'select',
    'button',
    'template',
    'noscript',
    'svg',
    'math',
    'link',
    'meta',
    'base',
    'title',
    'head',
    'body',
]);
const TIER_ELEMENTS = {
    block: new Set([...INLINE_ELEMENTS, ...BLOCK_ELEMENTS]),
    inline: INLINE_ELEMENTS,
    text: new Set(),
};
/**
 * Elements HTML gives no end tag. The builder needs this beyond its own void set:
 * `<input>` is dropped with its contents, but it never closes, so treating it as a
 * container would swallow the rest of the field.
 */
const HTML_VOID = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
]);
/** The complete attribute allowlist. Nothing here carries a URL, an id, or script. */
const CLASS_VALUES = new Set(['ds-bit', 'ds-slot', 'ds-flag', 'ds-val', 'ds-warn']);
const CLASS_TAGS = new Set(['span', 'code', 'td', 'th']);
const DATA_LANG = /^[a-z0-9-]{1,20}$/;
const MAX_SPAN = 20;
/** Structure the sanitizer enforces so the author does not have to: where a tag may live. */
const REQUIRED_PARENT = {
    li: ['ul', 'ol'],
    dt: ['dl'],
    dd: ['dl'],
    caption: ['table'],
    thead: ['table'],
    tbody: ['table'],
    tr: ['thead', 'tbody'],
    th: ['tr'],
    td: ['tr'],
};
/** …and, from the other side, what a structural parent will hold. These parents take no text. */
const STRUCTURAL_CHILDREN = {
    table: ['caption', 'thead', 'tbody'],
    thead: ['tr'],
    tbody: ['tr'],
    tr: ['th', 'td'],
    ul: ['li'],
    ol: ['li'],
    dl: ['dt', 'dd'],
};
/**
 * Implicit closes: which open elements a start tag ends. Any other block start ends
 * an open `<p>`, so authors can write paragraphs the way they write markdown.
 */
const IMPLICIT_CLOSE = {
    p: ['p'],
    li: ['li'],
    dt: ['dt', 'dd'],
    dd: ['dt', 'dd'],
    tr: ['tr', 'td', 'th'],
    th: ['th', 'td'],
    td: ['th', 'td'],
};
const CLOSE_P = ['p'];
/** An implicit close never reaches past a container: `<li><p>a` is not closed by a `<p>` two lists up. */
const CLOSE_BOUNDARY = [
    'ul',
    'ol',
    'dl',
    'table',
    'thead',
    'tbody',
    'tr',
    'td',
    'th',
    'li',
    'dt',
    'dd',
    'blockquote',
    'caption',
    'pre',
];
/** The one element the serializer invents, so a wide table can scroll on its own. */
const TABLE_WRAP_CLASS = 'ds-md-tablewrap';
/** Nesting past this is authoring noise; deeper content flattens to text. */
const MAX_DEPTH = 20;
/** Authoring problems are for a human to read, so repeats and long tails are pointless. */
const MAX_ISSUES = 20;
const NAME_CHAR = /[a-zA-Z0-9._:-]/;
const TAG_SPACE = /[\t\n\f\r ]/;
const ASCII_ALPHA = /[a-zA-Z]/;
// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------
/** Text-node escaping. Stricter than render.ts's esc(): `>` cannot start a tag, but
 *  escaping it keeps the output free of any character a parser treats as markup. */
function escapeText(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/** Attribute-value escaping. Both quote styles go, so the value cannot end its own attribute. */
function escapeAttr(s) {
    return escapeText(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/**
 * Character references we decode on the way in: the five HTML escapes, plus the
 * punctuation an author actually reaches for in prose. Decoding matters for the
 * fixpoint — the serializer writes `&amp;` for a literal `&`, so the tokenizer has to
 * read it back as `&` or every round trip would escape the escape. Numeric references
 * cover everything else; an unknown *name* stays literal text and is escaped on the way
 * out, which is the conservative reading: nothing can smuggle markup in through an
 * entity table we would then have to maintain.
 */
const NAMED_ENTITIES = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    mdash: '—',
    ndash: '–',
    hellip: '…',
    rarr: '→',
    larr: '←',
    times: '×',
    middot: '·',
    bull: '•',
    deg: '°',
    ne: '≠',
    le: '≤',
    ge: '≥',
    lsquo: '‘',
    rsquo: '’',
    ldquo: '“',
    rdquo: '”',
};
const ENTITY = /&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});/g;
function codePointText(code) {
    // NUL, the surrogate range and out-of-range scalars have no text meaning; HTML
    // maps them to the replacement character, and so do we.
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff)
        return '�';
    if (code >= 0xd800 && code <= 0xdfff)
        return '�';
    return String.fromCodePoint(code);
}
function decodeEntities(raw) {
    const text = raw.includes('\0') ? raw.replace(/\0/g, '') : raw;
    if (!text.includes('&'))
        return text;
    return text.replace(ENTITY, (match, body) => {
        if (body[0] === '#') {
            const hex = body[1] === 'x' || body[1] === 'X';
            return codePointText(parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10));
        }
        return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    });
}
/**
 * Scan the field into start / end / text tokens. Deliberately lenient: anything that
 * is not a well-formed tag is text, because a narrative field is prose first and the
 * tree builder — not the scanner — decides what survives.
 *
 * Comments, CDATA sections, doctypes and processing instructions are consumed and
 * dropped here, so no builder state has to know they exist. `<script>` and friends are
 * *not* scanned as raw text: they are dropped whole by the builder, which skips to the
 * matching end tag, so their contents never become tokens that matter.
 */
function tokenize(input) {
    const tokens = [];
    const n = input.length;
    let pending = '';
    let i = 0;
    function flush() {
        if (!pending)
            return;
        tokens.push({ type: 'text', value: decodeEntities(pending) });
        pending = '';
    }
    /** Consume `<!-- -->`, `<![CDATA[ ]]>`, `<!DOCTYPE …>` or any other `<!…>` bogus comment. */
    function skipDeclaration(start) {
        if (input.startsWith('<!--', start)) {
            // The early-close quirk: `<!-->` and `<!--->` are complete comments, not the
            // start of one that runs to the end of the field.
            const body = start + 4;
            if (input[body] === '>')
                return body + 1;
            if (input[body] === '-' && input[body + 1] === '>')
                return body + 2;
            const close = input.indexOf('-->', body);
            return close < 0 ? n : close + 3;
        }
        if (input.startsWith('<![CDATA[', start)) {
            const close = input.indexOf(']]>', start + 9);
            return close < 0 ? n : close + 3;
        }
        const close = input.indexOf('>', start + 2);
        return close < 0 ? n : close + 1;
    }
    /** Read the tag at `start` (`input[start]` is `<`). Returns null when the field ends
     *  mid-tag — the caller then keeps the raw source as text rather than losing it. */
    function readTag(start) {
        const isEnd = input[start + 1] === '/';
        let j = start + (isEnd ? 2 : 1);
        const nameStart = j;
        while (j < n && NAME_CHAR.test(input[j]))
            j += 1;
        const tag = input.slice(nameStart, j).toLowerCase();
        const attrs = [];
        const seen = new Set();
        let selfClosing = false;
        for (;;) {
            while (j < n && TAG_SPACE.test(input[j]))
                j += 1;
            if (j >= n)
                return null;
            if (input[j] === '>') {
                j += 1;
                break;
            }
            if (input[j] === '/') {
                // `/>` ends the tag; a `/` anywhere else is noise between attributes.
                if (input[j + 1] === '>') {
                    selfClosing = true;
                    j += 2;
                    break;
                }
                j += 1;
                continue;
            }
            const nameFrom = j;
            while (j < n && !TAG_SPACE.test(input[j]) && input[j] !== '=' && input[j] !== '>' && input[j] !== '/') {
                j += 1;
            }
            const name = input.slice(nameFrom, j).toLowerCase();
            while (j < n && TAG_SPACE.test(input[j]))
                j += 1;
            let value = '';
            if (input[j] === '=') {
                j += 1;
                while (j < n && TAG_SPACE.test(input[j]))
                    j += 1;
                const quote = input[j];
                if (quote === '"' || quote === "'") {
                    const close = input.indexOf(quote, j + 1);
                    if (close < 0)
                        return null;
                    value = decodeEntities(input.slice(j + 1, close));
                    j = close + 1;
                }
                else {
                    const valueFrom = j;
                    while (j < n && !TAG_SPACE.test(input[j]) && input[j] !== '>')
                        j += 1;
                    value = decodeEntities(input.slice(valueFrom, j));
                }
            }
            // First declaration of an attribute wins, as in every HTML parser.
            if (name && !seen.has(name)) {
                seen.add(name);
                attrs.push([name, value]);
            }
        }
        if (isEnd)
            return { token: { type: 'end', tag }, next: j };
        return { token: { type: 'start', tag, attrs, selfClosing }, next: j };
    }
    while (i < n) {
        if (input[i] !== '<') {
            const next = input.indexOf('<', i);
            const stop = next < 0 ? n : next;
            pending += input.slice(i, stop);
            i = stop;
            continue;
        }
        const after = input[i + 1];
        if (after === '!') {
            i = skipDeclaration(i);
            continue;
        }
        if (after === '?') {
            const close = input.indexOf('>', i + 2);
            i = close < 0 ? n : close + 1;
            continue;
        }
        // A `<` that cannot start a tag is just a `<` the author typed.
        const startsTag = after !== undefined &&
            (ASCII_ALPHA.test(after) || (after === '/' && ASCII_ALPHA.test(input[i + 2] ?? '')));
        if (!startsTag) {
            pending += '<';
            i += 1;
            continue;
        }
        const read = readTag(i);
        if (!read) {
            // Unterminated at EOF: keep the raw source as text so nothing the author wrote
            // silently disappears. It is escaped on the way out like any other prose.
            pending += input.slice(i);
            break;
        }
        flush();
        tokens.push(read.token);
        i = read.next;
    }
    flush();
    return tokens;
}
/**
 * Tokenize, validate and build the tree. The single parse behind all three
 * projections: HTML, text and speech all walk what this returns.
 */
export function parseNarrative(input, tier) {
    return buildTree(input, tier, []);
}
/**
 * The parse, with a sink for authoring problems. `narrativeIssues` runs this with a
 * real array and throws the tree away; `parseNarrative` does the opposite.
 */
function buildTree(input, tier, issues) {
    const allowed = TIER_ELEMENTS[tier];
    const root = [];
    const stack = [];
    /** While set, every token is swallowed until this element's end tag. */
    let skipTag = null;
    function note(message) {
        if (issues.length >= MAX_ISSUES || issues.includes(message))
            return;
        issues.push(message);
    }
    function top() {
        return stack.length ? stack[stack.length - 1] : null;
    }
    function host() {
        return top()?.host ?? root;
    }
    function hostTag() {
        return top()?.hostTag ?? '';
    }
    function depth() {
        return top()?.depth ?? 0;
    }
    /** Index of the innermost kept frame, or -1 when everything open is stripped. */
    function innermostKept() {
        for (let i = stack.length - 1; i >= 0; i -= 1) {
            if (stack[i].node)
                return i;
        }
        return -1;
    }
    function pushFrame(tag, node, siblings, implied) {
        const parent = top();
        stack.push({
            tag,
            node,
            siblings,
            host: node ? node.children : (parent?.host ?? root),
            hostTag: node ? tag : (parent?.hostTag ?? ''),
            depth: (parent?.depth ?? 0) + (node ? 1 : 0),
            implied,
        });
    }
    /** Close the top frame, running the structure checks that can only be made once
     *  an element has all of its children. */
    function closeFrame() {
        const frame = stack.pop();
        if (!frame || !frame.node || !frame.siblings)
            return;
        if (frame.tag === 'table')
            finishTable(frame.node, frame.siblings);
    }
    function closeThrough(index) {
        while (stack.length > index)
            closeFrame();
    }
    /**
     * A table earns its caption: without one the reader has a grid and no idea what it
     * tabulates, so an uncaptioned table is dropped rather than rendered. A caption that
     * arrived late is moved to the front, which is the sanitizer's job, not the author's.
     */
    function finishTable(node, siblings) {
        const at = node.children.findIndex((child) => child.type === 'element' && child.tag === 'caption');
        if (at < 0) {
            const index = siblings.indexOf(node);
            if (index >= 0)
                siblings.splice(index, 1);
            note('<table> without a <caption> is dropped — say what the table shows');
            return;
        }
        if (at > 0)
            node.children.unshift(...node.children.splice(at, 1));
    }
    /** Open an element the author did not write (the `<tbody>` a bare `<tr>` implies). */
    function openImplied(tag) {
        if (depth() >= MAX_DEPTH)
            return false;
        const node = { type: 'element', tag, attrs: [], children: [] };
        const siblings = host();
        siblings.push(node);
        pushFrame(tag, node, siblings, true);
        return true;
    }
    /** Close the innermost kept frame when it is one the builder invented. */
    function closeImpliedFrame() {
        const at = innermostKept();
        if (at < 0 || !stack[at].implied)
            return false;
        closeThrough(at);
        return true;
    }
    /** End the open elements a start tag implicitly closes, never reaching past a container. */
    function closeImplied(tag) {
        const targets = IMPLICIT_CLOSE[tag] ?? (BLOCK_ELEMENTS.has(tag) ? CLOSE_P : null);
        if (!targets)
            return;
        let found = -1;
        for (let i = stack.length - 1; i >= 0; i -= 1) {
            // A stripped frame contains nothing — its children were hoisted past it — so it
            // is neither a target nor a boundary. Only elements that reached the tree count.
            if (!stack[i].node)
                continue;
            // Keep scanning outwards: the outermost target before the boundary is the one
            // that closes, so `<tr><td>a<tr>` ends the cell *and* the row.
            if (targets.includes(stack[i].tag)) {
                found = i;
                continue;
            }
            if (CLOSE_BOUNDARY.includes(stack[i].tag))
                break;
        }
        if (found >= 0)
            closeThrough(found);
    }
    /** Can this tag live where it landed? Closes implied frames that are in the way. */
    function canPlace(tag) {
        for (;;) {
            const parent = hostTag();
            const required = REQUIRED_PARENT[tag];
            if (required && !required.includes(parent)) {
                // A bare `<tr>` in a `<table>` gets the `<tbody>` HTML would have given it.
                if (tag === 'tr' && parent === 'table') {
                    if (openImplied('tbody'))
                        continue;
                    return false;
                }
                if (closeImpliedFrame())
                    continue;
                return false;
            }
            const accepts = STRUCTURAL_CHILDREN[parent];
            if (accepts && !accepts.includes(tag)) {
                if (closeImpliedFrame())
                    continue;
                return false;
            }
            // One caption per table: a second one is stripped like any misplaced tag.
            if (tag === 'caption') {
                const table = stack[innermostKept()]?.node;
                if (table?.children.some((child) => child.type === 'element' && child.tag === 'caption'))
                    return false;
            }
            return true;
        }
    }
    function appendText(value) {
        if (!value)
            return;
        if (STRUCTURAL_CHILDREN[hostTag()]) {
            if (value.trim())
                note(`text directly inside <${hostTag()}> is dropped — put it in a cell or an item`);
            return;
        }
        const siblings = host();
        const last = siblings[siblings.length - 1];
        // Merge on append so unwrapping never leaves two adjacent text nodes behind: the
        // tree stays canonical, and every projection sees one run of prose.
        if (last && last.type === 'text') {
            last.value += value;
            return;
        }
        siblings.push({ type: 'text', value });
    }
    /** Keep only the attributes the allowlist names, in the shape it names them. */
    function keepAttrs(tag, attrs) {
        const kept = [];
        for (const [name, value] of attrs) {
            const canonical = attrValue(tag, name, value);
            if (canonical === null) {
                // The value is quoted back so the author can see which one lost, but only a
                // glimpse of it — a rejected attribute is often a long paste.
                const shown = value.length > 40 ? `${value.slice(0, 40)}…` : value;
                note(`${name}="${shown}" is not allowed on <${tag}> — the attribute is dropped`);
                continue;
            }
            kept.push([name, canonical]);
        }
        return kept;
    }
    function openTag(tag, attrs, selfClosing) {
        // Never opens a frame: nothing after it belongs to it.
        const closes = !selfClosing && !HTML_VOID.has(tag);
        if (DROP_WITH_CONTENTS.has(tag)) {
            note(`<${tag}> is dropped with everything inside it`);
            if (closes)
                skipTag = tag;
            return;
        }
        if (!allowed.has(tag)) {
            note(tier === 'block'
                ? `<${tag}> is not a narrative element — the tag is dropped, its text kept`
                : tier === 'inline'
                    ? `<${tag}> is not allowed in an inline field — the tag is dropped, its text kept`
                    : `<${tag}> is not allowed in a plain-text field — the tag is dropped, its text kept`);
            if (closes)
                pushFrame(tag, null, null, false);
            return;
        }
        closeImplied(tag);
        if (!canPlace(tag)) {
            note(`<${tag}> cannot sit inside <${hostTag() || 'the field'}> — the tag is dropped, its text kept`);
            if (closes)
                pushFrame(tag, null, null, false);
            return;
        }
        if (depth() >= MAX_DEPTH) {
            note(`markup nested deeper than ${MAX_DEPTH} elements is flattened to text`);
            if (closes)
                pushFrame(tag, null, null, false);
            return;
        }
        const node = { type: 'element', tag, attrs: keepAttrs(tag, attrs), children: [] };
        const siblings = host();
        siblings.push(node);
        if (VOID_ELEMENTS.has(tag))
            return;
        pushFrame(tag, node, siblings, false);
        // A self-closed non-void tag opens and closes in one step, so it runs the same
        // structural finish an explicit end tag would. Without this `<table/>` leaves an
        // empty captionless table that only the *second* pass drops, and the sanitizer
        // stops being a fixpoint.
        if (!closes)
            closeFrame();
    }
    function closeTag(tag) {
        for (let i = stack.length - 1; i >= 0; i -= 1) {
            if (stack[i].tag === tag) {
                closeThrough(i);
                return;
            }
        }
        // An end tag with nothing open to match says nothing; ignore it.
    }
    for (const token of tokenize(input)) {
        if (skipTag) {
            if (token.type === 'end' && token.tag === skipTag)
                skipTag = null;
            continue;
        }
        if (token.type === 'text')
            appendText(token.value);
        else if (token.type === 'end')
            closeTag(token.tag);
        else
            openTag(token.tag, token.attrs, token.selfClosing);
    }
    closeThrough(0);
    return root;
}
/** The canonical value for an allowlisted attribute, or null when it has no business here. */
function attrValue(tag, name, value) {
    switch (name) {
        case 'class':
            return CLASS_TAGS.has(tag) && CLASS_VALUES.has(value) ? value : null;
        case 'scope':
            return tag === 'th' && (value === 'row' || value === 'col') ? value : null;
        case 'colspan':
        case 'rowspan': {
            if (tag !== 'td' && tag !== 'th')
                return null;
            if (!/^[0-9]{1,3}$/.test(value))
                return null;
            const span = Number(value);
            // Emit the canonical spelling so `007` and `7` cannot serialize differently.
            return span >= 1 && span <= MAX_SPAN ? String(span) : null;
        }
        case 'data-lang':
            return tag === 'pre' && DATA_LANG.test(value) ? value : null;
        default:
            return null;
    }
}
// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------
/**
 * Walk the tree into HTML. Every tag, attribute name and quote here is written by
 * this function from a validated node — the input contributes escaped text and
 * escaped attribute values, nothing else.
 *
 * Exported for the round-trip test: `serialize(parseNarrative(x, t))` re-parses to
 * itself, which is what keeps the sanitizer honest.
 */
export function serialize(nodes) {
    let out = '';
    for (const node of nodes) {
        if (node.type === 'text') {
            out += escapeText(node.value);
            continue;
        }
        // The one invention: a scroll container so a wide table cannot widen the page.
        // On a re-parse the div is an unknown element, so it unwraps and is re-invented.
        if (node.tag === 'table')
            out += `<div class="${TABLE_WRAP_CLASS}">${serializeElement(node)}</div>`;
        else
            out += serializeElement(node);
    }
    return out;
}
function serializeElement(node) {
    let attrs = '';
    for (const [name, value] of node.attrs)
        attrs += ` ${name}="${escapeAttr(value)}"`;
    if (VOID_ELEMENTS.has(node.tag))
        return `<${node.tag}${attrs}>`;
    return `<${node.tag}${attrs}>${serialize(node.children)}</${node.tag}>`;
}
// ---------------------------------------------------------------------------
// Public projections
// ---------------------------------------------------------------------------
/** Sanitized HTML for the tier, ready to interpolate into a template. */
export function narrativeHtml(input, tier) {
    // At the text tier the field carries no markup, but its words still need the
    // block boundaries that produced them — otherwise two stripped paragraphs run
    // together as one word. The text projection already inserts those spaces.
    if (tier === 'text')
        return escapeText(narrativeText(input));
    return serialize(parseNarrative(input, tier));
}
/** All three projections of one field. */
export function narrative(input, tier) {
    return {
        html: narrativeHtml(input, tier),
        text: narrativeText(input),
        speech: narrativeSpeech(input, tier),
    };
}
/** Authoring-time problems for validateTour; empty array means clean. */
export function narrativeIssues(input, tier) {
    const issues = [];
    buildTree(input, tier, issues);
    return issues;
}
/**
 * Ends a spoken segment with sentence punctuation, without doubling it.
 *
 * Joining these segments with a bare ". " produced "…where to continue.. The
 * primer sits…" whenever a segment already ended in punctuation.
 */
function endsSentence(text) {
    return /[.!?:;]$/.test(text) ? text : `${text}.`;
}
/** Every run of whitespace becomes one space; the leading and trailing runs go. */
function collapseSpace(text) {
    return text.replace(/\s+/g, ' ').trim();
}
/**
 * A tag that parts the words on either side of it. Phrasing content runs on
 * with its neighbours, so `<code>parse</code>d` stays one word; every block
 * tag, plus `<br>`, contributes a space instead.
 */
function isTextBoundary(tag) {
    return tag === 'br' || !INLINE_ELEMENTS.has(tag);
}
function collectText(nodes, parts) {
    for (const node of nodes) {
        if (node.type === 'text') {
            parts.push(node.value);
            continue;
        }
        const boundary = isTextBoundary(node.tag);
        if (boundary)
            parts.push(' ');
        collectText(node.children, parts);
        if (boundary)
            parts.push(' ');
    }
}
/**
 * Plain text for a node list, with block boundaries parting the words.
 *
 * `textContent` runs blocks together — `<p>A.</p><p>B.</p>` reads back as
 * "A.B." — and that reached the places where the text is measured rather than
 * displayed: the 64-character rail label clipped mid-merged-word, and the
 * concept word count scored two words as one.
 */
function flattenText(nodes) {
    const parts = [];
    collectText(nodes, parts);
    return collapseSpace(parts.join(''));
}
/**
 * Plain text for attributes, aria-labels, truncation and word counts.
 *
 * Tier-independent on purpose: it parses as `block` whatever tier the field
 * actually has, so a field authored richer than it is allowed to be still reads
 * as sentences here instead of spilling angle brackets into a title attribute.
 * Whether that markup was permitted is `narrativeIssues`' question, not this
 * one's.
 */
export function narrativeText(input) {
    return flattenText(parseNarrative(input, 'block'));
}
/** Elements the narrator reads as a sentence of their own. */
const SPEECH_SENTENCES = new Set([
    'p', 'h2', 'h3', 'h4', 'li', 'blockquote', 'dd',
]);
function pushSentence(sink, text) {
    const clean = collapseSpace(text);
    if (clean)
        sink.segments.push(endsSentence(clean));
}
function flushPending(sink) {
    if (!sink.pending.length)
        return;
    const pending = sink.pending.join('');
    sink.pending = [];
    pushSentence(sink, pending);
}
function speakNodes(nodes, sink) {
    for (const node of nodes) {
        if (node.type === 'text')
            sink.pending.push(node.value);
        else
            speakElement(node, sink);
    }
}
function speakElement(el, sink) {
    // Code is read, not heard. Spoken aloud a `pre` is a stream of punctuation
    // names, and it is on screen for the listener the whole time anyway.
    if (el.tag === 'pre')
        return;
    // A table's cells are data. Its caption is the one sentence that says what
    // the reader is looking at, so the caption is the whole of what is narrated.
    if (el.tag === 'table') {
        flushPending(sink);
        const caption = el.children.find((child) => child.type === 'element' && child.tag === 'caption');
        if (caption)
            pushSentence(sink, flattenText(caption.children));
        return;
    }
    if (el.tag === 'dl') {
        speakDefinitionList(el, sink);
        return;
    }
    if (SPEECH_SENTENCES.has(el.tag)) {
        // Whatever was running ends here, then this element's own words are a
        // sentence. A list nested inside an `li` flushes the outer item on its way
        // past, so the narrator says things in the order the author wrote them.
        flushPending(sink);
        speakNodes(el.children, sink);
        flushPending(sink);
        return;
    }
    // A rule or a line break is a pause in the prose, not a sentence of its own.
    if (el.tag === 'hr' || el.tag === 'br') {
        sink.pending.push(' ');
        return;
    }
    speakNodes(el.children, sink);
}
/**
 * A definition list is spoken the way it is read: "term: definition." Saying
 * the halves as two sentences loses which one was which, so the term keeps its
 * definitions company — including the second and third definition of the same
 * term, where dropping it would leave a sentence with no subject.
 */
function speakDefinitionList(el, sink) {
    flushPending(sink);
    let term = '';
    let termSpoken = false;
    for (const child of el.children) {
        if (child.type !== 'element')
            continue;
        if (child.tag === 'dt') {
            if (term && !termSpoken)
                pushSentence(sink, term);
            term = flattenText(child.children);
            termSpoken = false;
            continue;
        }
        if (child.tag === 'dd') {
            // Either half can be missing; joining only when both are there keeps a
            // stray "term:" out of the stream.
            const definition = flattenText(child.children);
            pushSentence(sink, term && definition ? `${term}: ${definition}` : `${term}${definition}`);
            termSpoken = true;
            continue;
        }
        speakElement(child, sink);
    }
    if (term && !termSpoken)
        pushSentence(sink, term);
}
/**
 * The speech stream for the narrator.
 *
 * Every block that carries prose becomes its own sentence, so the narrator
 * pauses where the reader's eye would. Code blocks are skipped and tables come
 * down to their caption: those are the two places where reading the markup
 * aloud is worse than saying nothing about it.
 */
export function narrativeSpeech(input, tier) {
    // A text-tier field carries no markup, so all three of its projections are the
    // same words. Any block structure the author wrote is a source of word
    // boundaries only, never of sentences — a title is not read as paragraphs.
    if (tier === 'text')
        return collapseSpace(narrativeText(input));
    const sink = { segments: [], pending: [] };
    speakNodes(parseNarrative(input, tier), sink);
    flushPending(sink);
    return collapseSpace(sink.segments.join(' '));
}
