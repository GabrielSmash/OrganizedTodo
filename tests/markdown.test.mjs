import assert from "node:assert/strict";
import { markdownToMarkup as md, markdownToPlain as plain, firstLink, noteBlocks } from "../markdown.js";

const CODE = (s) => `<span font_family="monospace" background="#ffffff" bgalpha="15%">${s}</span>`;
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok -", name); };

t("plain text is only escaped", () => {
    assert.equal(md("comprar pão"), "comprar pão");
    assert.equal(md(`a < b & c > d "e" 'f'`), "a &lt; b &amp; c &gt; d &quot;e&quot; &#39;f&#39;");
    assert.equal(md("<b>x</b>"), "&lt;b&gt;x&lt;/b&gt;");
});

t("quote and list item", () => {
    assert.equal(md("> observação"), `<span style="italic" fgalpha="70%">▎ observação</span>`);
    assert.equal(md("- item"), "• item");
    assert.equal(md("* item"), "• item");
});

t("code spans keep their content as typed", () => {
    assert.equal(md("rodar `npm test`"), `rodar ${CODE("npm test")}`);
    assert.equal(md("```cargo build```"), CODE("cargo build"));
    assert.equal(md("`**x** <y>`"), CODE("**x** &lt;y&gt;"));
});

t("bold, italic, strike, link", () => {
    assert.equal(md("**a** e *b*"), "<b>a</b> e <i>b</i>");
    assert.equal(md("~~velho~~"), "<s>velho</s>");
    assert.equal(md("ver [docs](https://gnome.org)"), "ver <u>docs</u>");
    assert.equal(md("**a** **b**"), "<b>a</b> <b>b</b>");
});

t("styles combine", () => {
    assert.equal(md("**bold com `code`**"), `<b>bold com ${CODE("code")}</b>`);
    assert.equal(md("> ver `log`"), `<span style="italic" fgalpha="70%">▎ ver ${CODE("log")}</span>`);
});

t("things that are not markdown stay as typed", () => {
    for (const text of ["# sem títulos", "#bug", "2 * 3 * 4", "snake_case_name", "**não fechado", "```", "[sem url]", "*", "arquivo.txt", "v1.2"]) {
        assert.equal(md(text), text);
    }
});

t("plain text drops the markers", () => {
    assert.equal(plain("**Projeto** `A`"), "Projeto A");
    assert.equal(plain("> nota"), "nota");
    assert.equal(plain("- item"), "• item");
    assert.equal(plain("a < b"), "a < b");
});

t("bare www. and http(s):// addresses become links, without trailing punctuation", () => {
    assert.equal(md("ver www.site.com."), "ver <u>www.site.com</u>.");
    assert.equal(md("(https://a.org/x_y?q=1)"), "(<u>https://a.org/x_y?q=1</u>)");
    assert.equal(md("**www.a.com**"), "<b><u>www.a.com</u></b>");
    assert.equal(md("`www.a.com`"), `<span font_family="monospace" background="#ffffff" bgalpha="15%">www.a.com</span>`);
    assert.equal(plain("ver www.site.com"), "ver www.site.com");
});

t("link targets without a scheme are completed", () => {
    assert.equal(firstLink("ver www.site.com"), "https://www.site.com");
    assert.equal(firstLink("[site](www.site.com)"), "https://www.site.com");
    assert.equal(firstLink("[site](site.com/docs?x=1)"), "https://site.com/docs?x=1");
    assert.equal(firstLink("[eu](eu@site.com)"), "mailto:eu@site.com");
    assert.equal(firstLink("[n](notas)"), null);
    assert.equal(firstLink("[n](../arquivo)"), null);
});

t("firstLink: the first web or e-mail link, never other schemes or code", () => {
    assert.equal(firstLink("ver [a](https://a.org) e [b](https://b.org)"), "https://a.org");
    assert.equal(firstLink("[mail](mailto:eu@x.org)"), "mailto:eu@x.org");
    assert.equal(firstLink("[x](file:///etc/passwd) [y](http://y.org)"), "http://y.org");
    assert.equal(firstLink("[x](ssh://host)"), null);
    assert.equal(firstLink("`[a](https://a.org)`"), null);
    assert.equal(firstLink("sem link"), null);
});

// A code block is drawn as a box by the UI: only its colors are in the markup
const BLOCK = (markup) => ({ block: markup });
const notes = (text) => noteBlocks(text).map((block) => (block.code ? BLOCK(block.markup) : block.markup));

t("notes: headings, numbered items, checkboxes and rules", () => {
    assert.deepEqual(notes("# Plano\n## Fase *1*\n### Detalhe"), [
        `<span weight="bold" size="x-large">Plano</span>`,
        `<span weight="bold" size="large">Fase <i>1</i></span>`,
        `<span weight="bold" size="medium">Detalhe</span>`,
    ]);
    assert.deepEqual(notes("1. um\n2) dois\n- [ ] fazer\n- [x] **feito**\n---"), [
        "1. um", "2. dois", "☐ fazer", "☑ <b>feito</b>", `<span fgalpha="40%">${"─".repeat(24)}</span>`,
    ]);
    // Headings need the space, as in standard markdown
    assert.deepEqual(notes("#tag\n####  quatro"), ["#tag", "####  quatro"]);
});

t("notes: names' line kinds, indentation and blank lines are kept", () => {
    assert.deepEqual(notes("> obs\n\n- a\n  - b\n  1. c"), [
        `<span style="italic" fgalpha="70%">▎ obs</span>`, "", "• a", "  • b", "  1. c",
    ]);
});

t("notes: code blocks keep lines as typed; unclosed blocks run to the end", () => {
    assert.deepEqual(notes("antes\n```\nconst a = 1 < 2;\n**x**\n```\ndepois"), [
        "antes", BLOCK("const a = 1 &lt; 2;\n**x**"), "depois",
    ]);
    assert.deepEqual(notes("```\n# não é título"), [BLOCK("# não é título")]);
    // A one-line ```code``` is inline code, not a block
    assert.deepEqual(notes("```ls```"), [CODE("ls")]);
});

t("notes: each line opens its own link; code blocks have none", () => {
    const blocks = noteBlocks("ver www.a.com\nsem link\n- [doc](b.org)\n```\nwww.c.com\n```");
    assert.deepEqual(blocks.map((block) => block.link), ["https://www.a.com", null, "https://b.org", null]);
});

const color = (attrs, text) => `<span ${attrs}>${text}</span>`;
const KEYWORD = (s) => color(`foreground="#dc8add"`, s);
const FUNCTION = (s) => color(`foreground="#99c1f1"`, s);
const STRING = (s) => color(`foreground="#8ff0a4"`, s);
const NUMBER = (s) => color(`foreground="#ffbe6f"`, s);
const COMMENT = (s) => color(`foreground="#9a9996" style="italic"`, s);

t("code blocks: known languages are colored, by name or alias", () => {
    assert.deepEqual(notes("```py\ndef teste(teste):\n    print(teste)  # \"oi\"\n```"), [BLOCK(
        `${KEYWORD("def")} ${FUNCTION("teste")}(teste):\n    ${FUNCTION("print")}(teste)  ${COMMENT("# &quot;oi&quot;")}`,
    )]);
    assert.deepEqual(notes("```Python\nx = 'a<b' + 1.5\n```"), [BLOCK(`x = ${STRING("&#39;a&lt;b&#39;")} + ${NUMBER("1.5")}`)]);
    // A keyword before "(" is still a keyword; Rust macros count as calls
    assert.deepEqual(notes("```js\nif (ok) run() // fim\n```"), [BLOCK(`${KEYWORD("if")} (ok) ${FUNCTION("run")}() ${COMMENT("// fim")}`)]);
    assert.deepEqual(notes("```rs\nprintln!(\"{}\", None);\n```"), [BLOCK(`${FUNCTION("println!")}(${STRING("&quot;{}&quot;")}, ${NUMBER("None")});`)]);
});

t("code blocks: markers inside strings and comments are not colored again", () => {
    assert.deepEqual(notes("```py\ns = \"# def\"  # if \"x\"\n```"), [BLOCK(`s = ${STRING("&quot;# def&quot;")}  ${COMMENT("# if &quot;x&quot;")}`)]);
    assert.deepEqual(notes("```py\n\"\"\"doc\ndef x\"\"\"\n```"), [BLOCK(STRING("&quot;&quot;&quot;doc\ndef x&quot;&quot;&quot;"))]);
});

t("code blocks: unknown or missing language is only escaped", () => {
    assert.deepEqual(notes("```cobol\ndef if(1)\n```"), [BLOCK("def if(1)")]);
    assert.deepEqual(notes("```\nreturn 1 < 2\n```"), [BLOCK("return 1 &lt; 2")]);
});

console.log(`\n${n} markdown tests passed`);
