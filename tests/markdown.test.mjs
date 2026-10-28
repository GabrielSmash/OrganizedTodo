import assert from "node:assert/strict";
import { markdownToMarkup as md, markdownToPlain as plain, firstLink } from "../markdown.js";

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

console.log(`\n${n} markdown tests passed`);
