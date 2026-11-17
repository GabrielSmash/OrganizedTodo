import assert from "node:assert/strict";
import { markdownToMarkup as md, markdownToPlain as plain, firstLink, noteBlocks } from "../markdown.js";

const CODE = (s) => `<span font_family="monospace" background="#ffffff" bgalpha="15%">${s}</span>`;
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok -", name); };

t("plain text is only escaped", () => {
    assert.equal(md("buy café"), "buy café");
    assert.equal(md(`a < b & c > d "e" 'f'`), "a &lt; b &amp; c &gt; d &quot;e&quot; &#39;f&#39;");
    assert.equal(md("<b>x</b>"), "&lt;b&gt;x&lt;/b&gt;");
});

t("quote and list item", () => {
    assert.equal(md("> remark"), `<span style="italic" fgalpha="70%">▎ remark</span>`);
    assert.equal(md("- item"), "• item");
    assert.equal(md("* item"), "• item");
});

t("code spans keep their content as typed", () => {
    assert.equal(md("run `npm test`"), `run ${CODE("npm test")}`);
    assert.equal(md("```cargo build```"), CODE("cargo build"));
    assert.equal(md("`**x** <y>`"), CODE("**x** &lt;y&gt;"));
});

t("bold, italic, strike, link", () => {
    assert.equal(md("**a** and *b*"), "<b>a</b> and <i>b</i>");
    assert.equal(md("~~old~~"), "<s>old</s>");
    assert.equal(md("see [docs](https://gnome.org)"), "see <u>docs</u>");
    assert.equal(md("**a** **b**"), "<b>a</b> <b>b</b>");
});

t("styles combine", () => {
    assert.equal(md("**bold with `code`**"), `<b>bold with ${CODE("code")}</b>`);
    assert.equal(md("> see `log`"), `<span style="italic" fgalpha="70%">▎ see ${CODE("log")}</span>`);
});

t("things that are not markdown stay as typed", () => {
    for (const text of ["# no headings", "#bug", "2 * 3 * 4", "snake_case_name", "**not closed", "```", "[no url]", "*", "file.txt", "v1.2"]) {
        assert.equal(md(text), text);
    }
});

t("plain text drops the markers", () => {
    assert.equal(plain("**Project** `A`"), "Project A");
    assert.equal(plain("> note"), "note");
    assert.equal(plain("- item"), "• item");
    assert.equal(plain("a < b"), "a < b");
});

t("bare www. and http(s):// addresses become links, without trailing punctuation", () => {
    assert.equal(md("see www.site.com."), "see <u>www.site.com</u>.");
    assert.equal(md("(https://a.org/x_y?q=1)"), "(<u>https://a.org/x_y?q=1</u>)");
    assert.equal(md("**www.a.com**"), "<b><u>www.a.com</u></b>");
    assert.equal(md("`www.a.com`"), `<span font_family="monospace" background="#ffffff" bgalpha="15%">www.a.com</span>`);
    assert.equal(plain("see www.site.com"), "see www.site.com");
});

t("link targets without a scheme are completed", () => {
    assert.equal(firstLink("see www.site.com"), "https://www.site.com");
    assert.equal(firstLink("[site](www.site.com)"), "https://www.site.com");
    assert.equal(firstLink("[site](site.com/docs?x=1)"), "https://site.com/docs?x=1");
    assert.equal(firstLink("[me](me@site.com)"), "mailto:me@site.com");
    assert.equal(firstLink("[n](notes)"), null);
    assert.equal(firstLink("[n](../file)"), null);
});

t("firstLink: the first web or e-mail link, never other schemes or code", () => {
    assert.equal(firstLink("see [a](https://a.org) and [b](https://b.org)"), "https://a.org");
    assert.equal(firstLink("[mail](mailto:me@x.org)"), "mailto:me@x.org");
    assert.equal(firstLink("[x](file:///etc/passwd) [y](http://y.org)"), "http://y.org");
    assert.equal(firstLink("[x](ssh://host)"), null);
    assert.equal(firstLink("`[a](https://a.org)`"), null);
    assert.equal(firstLink("no link"), null);
});

// A code block is drawn as a box by the UI: only its colors are in the markup
const BLOCK = (markup) => ({ block: markup });
const notes = (text) => noteBlocks(text).map((block) => (block.code ? BLOCK(block.markup) : block.markup));

t("notes: headings, numbered items, checkboxes and rules", () => {
    assert.deepEqual(notes("# Plan\n## Phase *1*\n### Detail"), [
        `<span weight="bold" size="x-large">Plan</span>`,
        `<span weight="bold" size="large">Phase <i>1</i></span>`,
        `<span weight="bold" size="medium">Detail</span>`,
    ]);
    assert.deepEqual(notes("1. one\n2) two\n- [ ] do\n- [x] **done**\n---"), [
        "1. one", "2. two", "☐ do", "☑ <b>done</b>", `<span fgalpha="40%">${"─".repeat(24)}</span>`,
    ]);
    // Headings need the space, as in standard markdown
    assert.deepEqual(notes("#tag\n####  four"), ["#tag", "####  four"]);
});

t("notes: names' line kinds, indentation and blank lines are kept", () => {
    assert.deepEqual(notes("> remark\n\n- a\n  - b\n  1. c"), [
        `<span style="italic" fgalpha="70%">▎ remark</span>`, "", "• a", "  • b", "  1. c",
    ]);
});

t("notes: code blocks keep lines as typed; unclosed blocks run to the end", () => {
    assert.deepEqual(notes("before\n```\nconst a = 1 < 2;\n**x**\n```\nafter"), [
        "before", BLOCK("const a = 1 &lt; 2;\n**x**"), "after",
    ]);
    assert.deepEqual(notes("```\n# not a heading"), [BLOCK("# not a heading")]);
    // A one-line ```code``` is inline code, not a block
    assert.deepEqual(notes("```ls```"), [CODE("ls")]);
});

t("notes: each line opens its own link; code blocks have none", () => {
    const blocks = noteBlocks("see www.a.com\nno link\n- [doc](b.org)\n```\nwww.c.com\n```");
    assert.deepEqual(blocks.map((block) => block.link), ["https://www.a.com", null, "https://b.org", null]);
});

const color = (attrs, text) => `<span ${attrs}>${text}</span>`;
const KEYWORD = (s) => color(`foreground="#dc8add"`, s);
const FUNCTION = (s) => color(`foreground="#99c1f1"`, s);
const STRING = (s) => color(`foreground="#8ff0a4"`, s);
const NUMBER = (s) => color(`foreground="#ffbe6f"`, s);
const COMMENT = (s) => color(`foreground="#9a9996" style="italic"`, s);

t("code blocks: known languages are colored, by name or alias", () => {
    assert.deepEqual(notes("```py\ndef check(value):\n    print(value)  # \"hi\"\n```"), [BLOCK(
        `${KEYWORD("def")} ${FUNCTION("check")}(value):\n    ${FUNCTION("print")}(value)  ${COMMENT("# &quot;hi&quot;")}`,
    )]);
    assert.deepEqual(notes("```Python\nx = 'a<b' + 1.5\n```"), [BLOCK(`x = ${STRING("&#39;a&lt;b&#39;")} + ${NUMBER("1.5")}`)]);
    // A keyword before "(" is still a keyword; Rust macros count as calls
    assert.deepEqual(notes("```js\nif (ok) run() // end\n```"), [BLOCK(`${KEYWORD("if")} (ok) ${FUNCTION("run")}() ${COMMENT("// end")}`)]);
    assert.deepEqual(notes("```rs\nprintln!(\"{}\", None);\n```"), [BLOCK(`${FUNCTION("println!")}(${STRING("&quot;{}&quot;")}, ${NUMBER("None")});`)]);
});

t("light theme: inline code and code colors are darker, readable on white; dark is the default", () => {
    assert.equal(md("`x`", { light: true }), `<span font_family="monospace" background="#000000" bgalpha="8%">x</span>`);
    assert.equal(md("`x`"), CODE("x"));
    const [block] = noteBlocks("```py\ndef f(): pass\n```", { light: true });
    assert.match(block.markup, /foreground="#8a3f99">def</);
    assert.match(noteBlocks("```py\ndef f(): pass\n```")[0].markup, /foreground="#dc8add">def</);
    assert.match(noteBlocks("`y`", { light: true })[0].markup, /bgalpha="8%"/);
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
