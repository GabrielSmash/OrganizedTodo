// Markdown for one-line names: rendered when drawing, the stored text stays as typed.
// Line start: "> quote", "- item". Inline: `code`, ```code```,
// **bold**, *italic*, ~~strike~~, [text](url), and bare www./http(s):// addresses.

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
