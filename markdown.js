// Markdown for one-line names: rendered when drawing, the stored text stays as typed.
// Line start: "> quote", "- item". Inline: `code`, ```code```,
// **bold**, *italic*, ~~strike~~, [text](url), and bare www./http(s):// addresses.
// Notes (several lines) also take "# headings", ``` code blocks ```, "1. items",
// "- [ ] checkboxes" and "---" rules.

// Code spans first: their content is shown as typed, never parsed further
// A bare address does not take trailing punctuation: "see www.site.com." links www.site.com
const INLINE = /```(.+?)```|`([^`]+)`|\*\*(.+?)\*\*|~~(.+?)~~|\*([^*\s](?:[^*]*[^*\s])?)\*|\[([^\]]+)\]\(([^)\s]+)\)|((?:https?:\/\/|www\.)[^\s<>()[\]]*[^\s<>()[\].,;:!?'"])/g;

// Only these are opened: other schemes (file:, ssh:, ...) could start arbitrary programs
const SAFE_LINK = /^(https?:|mailto:)/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const DOMAIN = /^[\w-]+(\.[\w-]+)+([/?#]\S*)?$/;
const EMAIL = /^[^\s@]+@[\w-]+(\.[\w-]+)+$/;

/** What to open for a link target: adds the scheme people usually leave out; null when unsafe. */
function linkTarget(url) {
    if (SCHEME.test(url)) {
        return SAFE_LINK.test(url) ? url : null;
    }
    if (EMAIL.test(url)) {
        return `mailto:${url}`;
    }
    if (DOMAIN.test(url)) {
        return `https://${url}`;
    }
    return null;
}

const escapeMarkup = (text) => text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Pango markup, for labels. */
const MARKUP = {
    text: escapeMarkup,
    quote: (inner) => `<span style="italic" fgalpha="70%">▎ ${inner}</span>`,
    item: (inner) => `• ${inner}`,
    code: (inner) => `<span font_family="monospace" background="#ffffff" bgalpha="15%">${inner}</span>`,
    bold: (inner) => `<b>${inner}</b>`,
    italic: (inner) => `<i>${inner}</i>`,
    strike: (inner) => `<s>${inner}</s>`,
    link: (inner) => `<u>${inner}</u>`,
};

const HEADING_SIZES = ["x-large", "large", "medium"];

/** Pango markup for the line kinds that only notes have. */
const NOTE_MARKUP = {
    heading: (level, inner) => `<span weight="bold" size="${HEADING_SIZES[level - 1]}">${inner}</span>`,
    numbered: (number, inner) => `${number}. ${inner}`,
    check: (done, inner) => `${done ? "☑" : "☐"} ${inner}`,
    rule: () => `<span fgalpha="40%">${"─".repeat(24)}</span>`,
};

/** Text without the markers, for places that take no markup (notifications). */
const PLAIN = {
    text: (text) => text,
    quote: (inner) => inner,
    item: (inner) => `• ${inner}`,
    code: (inner) => inner,
    bold: (inner) => inner,
    italic: (inner) => inner,
    strike: (inner) => inner,
    link: (inner) => inner,
};

function renderInline(text, out) {
    let result = "";
    let last = 0;
    for (const match of text.matchAll(INLINE)) {
        const [, fence, code, bold, strike, italic, linkText, , bare] = match;
        result += out.text(text.slice(last, match.index));
        if (fence !== undefined || code !== undefined) {
            result += out.code(out.text(fence ?? code));
        }
        else if (bold !== undefined) {
            result += out.bold(renderInline(bold, out));
        }
        else if (strike !== undefined) {
            result += out.strike(renderInline(strike, out));
        }
        else if (italic !== undefined) {
            result += out.italic(renderInline(italic, out));
        }
        else if (linkText !== undefined) {
            result += out.link(renderInline(linkText, out));
        }
        else {
            result += out.link(out.text(bare));
        }
        last = match.index + match[0].length;
    }
    return result + out.text(text.slice(last));
}

function render(text, out) {
    const quote = text.match(/^>\s?(.*)$/);
    if (quote) {
        return out.quote(renderInline(quote[1], out));
    }
    const item = text.match(/^[-*]\s+(.*)$/);
    if (item) {
        return out.item(renderInline(item[1], out));
    }
    return renderInline(text, out);
}

/** One line of a note: indentation kept as typed, then the note-only kinds, then the name ones. */
function renderNoteLine(line, out) {
    const [, indent, rest] = line.match(/^(\s*)(.*)$/);
    const heading = rest.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
        return indent + NOTE_MARKUP.heading(heading[1].length, renderInline(heading[2], out));
    }
    if (/^([-*_])\1{2,}$/.test(rest)) {
        return indent + NOTE_MARKUP.rule();
    }
    const check = rest.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (check) {
        return indent + NOTE_MARKUP.check(check[1] !== " ", renderInline(check[2], out));
    }
    const numbered = rest.match(/^(\d+)[.)]\s+(.*)$/);
    if (numbered) {
        return indent + NOTE_MARKUP.numbered(numbered[1], renderInline(numbered[2], out));
    }
    return indent + render(rest, out);
}

// ---- code blocks: light syntax highlighting, one regex per language ----

const CODE_COLORS = {
    comment: `foreground="#9a9996" style="italic"`,
    string: `foreground="#8ff0a4"`,
    number: `foreground="#ffbe6f"`,
    constant: `foreground="#ffbe6f"`,
    keyword: `foreground="#dc8add"`,
    function: `foreground="#99c1f1"`,
};

// Strings on one line, which may hold a quote escaped with a backslash
const QUOTED = String.raw`"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'`;
const C_COMMENT = String.raw`\/\/.*|\/\*[\s\S]*?\*\/`;

// Patterns use only (?:...) groups: the token regex below numbers its own groups
const LANGUAGES = {
    python: {
        keywords: "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case",
        constants: "True False None self",
        comment: "#.*",
        string: String.raw`"""[\s\S]*?"""|'''[\s\S]*?'''|${QUOTED}`,
    },
    javascript: {
        keywords: "async await break case catch class const continue default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while yield",
        constants: "true false null undefined NaN",
        comment: C_COMMENT,
        // \x60 is the backtick of template strings
        string: String.raw`\x60(?:\\.|[^\x60\\])*\x60|${QUOTED}`,
    },
    rust: {
        keywords: "as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while",
        constants: "true false None Some Ok Err",
        comment: C_COMMENT,
        string: String.raw`"(?:\\.|[^"\\])*"`,
    },
    shell: {
        keywords: "if then else elif fi for while until do done case esac in function return local export break continue",
        constants: "true false",
        comment: "#.*",
        string: String.raw`"(?:\\.|[^"\\])*"|'[^']*'`,
    },
    json: {
        keywords: "",
        constants: "true false null",
        // JSON has no comments: a pattern that never matches
        comment: "(?!)",
        string: QUOTED,
    },
};

const LANGUAGE_NAMES = {
    py: "python", python: "python",
    js: "javascript", javascript: "javascript", ts: "javascript", typescript: "javascript",
    rs: "rust", rust: "rust",
    sh: "shell", bash: "shell", shell: "shell",
    json: "json",
};

// Groups: 1 comment, 2 string, 3 number, 4 word ("name!" only right before "(", for Rust macros)
const SYNTAX = Object.fromEntries(Object.entries(LANGUAGES).map(([name, language]) => [name, {
    keywords: new Set(language.keywords.split(" ")),
    constants: new Set(language.constants.split(" ")),
    tokens: new RegExp(String.raw`(${language.comment})|(${language.string})|\b(\d+(?:\.\d+)?)\b|([A-Za-z_]\w*(?:!(?=\s*\())?)`, "g"),
}]));

function tokenKind(syntax, [, comment, string, number, word], after) {
    if (comment !== undefined) {
        return "comment";
    }
    if (string !== undefined) {
        return "string";
    }
    if (number !== undefined) {
        return "number";
    }
    if (syntax.keywords.has(word)) {
        return "keyword";
    }
    if (syntax.constants.has(word)) {
        return "constant";
    }
    return /^\s*\(/.test(after) ? "function" : null;
}

/** Code as Pango markup, colored when the language is known; otherwise only escaped. */
function highlightCode(code, language) {
    const syntax = SYNTAX[LANGUAGE_NAMES[language.toLowerCase()]];
    if (!syntax) {
        return escapeMarkup(code);
    }
    let result = "";
    let last = 0;
    for (const match of code.matchAll(syntax.tokens)) {
        const end = match.index + match[0].length;
        const kind = tokenKind(syntax, match, code.slice(end));
        const token = escapeMarkup(match[0]);
        result += escapeMarkup(code.slice(last, match.index));
        result += kind ? `<span ${CODE_COLORS[kind]}>${token}</span>` : token;
        last = end;
    }
    return result + escapeMarkup(code.slice(last));
}

// A line with only ``` (and maybe a language name) opens or closes a code block
const FENCE = /^\s*```([^`]*)$/;

/**
 * A note as blocks to draw one under the other: { markup, link, code }.
 * Each line is its own block, so a click opens the link of the line clicked;
 * a code block is one block, shown as typed (colored for known languages);
 * `code` tells the UI to draw it as a box.
 * An unclosed block runs to the end.
 */
export function noteBlocks(text) {
    const blocks = [];
    let code = null;
    let language = "";
    const closeCode = () => {
        blocks.push({ markup: highlightCode(code.join("\n"), language), link: null, code: true });
        code = null;
    };
    for (const line of text.split("\n")) {
        const fence = line.match(FENCE);
        if (fence) {
            if (code === null) {
                code = [];
                language = fence[1].trim();
            }
            else {
                closeCode();
            }
            continue;
        }
        if (code !== null) {
            code.push(line);
            continue;
        }
        blocks.push({ markup: renderNoteLine(line, MARKUP), link: firstLink(line), code: false });
    }
    if (code !== null) {
        closeCode();
    }
    return blocks;
}

export const markdownToMarkup = (text) => render(text, MARKUP);
export const markdownToPlain = (text) => render(text, PLAIN);

/** First link in `text` that is safe to open (web or e-mail), or null. */
export function firstLink(text) {
    for (const match of text.matchAll(INLINE)) {
        const url = match[7] ?? match[8];
        const target = url === undefined ? null : linkTarget(url);
        if (target) {
            return target;
        }
    }
    return null;
}
