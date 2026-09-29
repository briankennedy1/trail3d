import test from 'node:test';
import assert from 'node:assert/strict';
import {descriptionMarkdown} from '../src/description-markdown.js';

test('descriptions render headings, emphasis, lists, links, quotes and code',()=>{
  const html=descriptionMarkdown('## The ride\n\n**Climb** then *descend*.\n\n- First section\n- Second section\n\n1. Park\n2. Ride\n\n[Route](https://example.org/ride?a=1&b=2)\n\n> Bring water.\n\n`singletrack`');
  assert.match(html,/<h2>The ride<\/h2>/);
  assert.match(html,/<strong>Climb<\/strong> then <em>descend<\/em>/);
  assert.match(html,/<ul>\s*<li>First section<\/li>\s*<li>Second section<\/li>\s*<\/ul>/);
  assert.match(html,/<ol>\s*<li>Park<\/li>\s*<li>Ride<\/li>\s*<\/ol>/);
  assert.match(html,/<a target="_blank" rel="noopener noreferrer" href="https:\/\/example.org\/ride\?a=1&amp;b=2">Route<\/a>/);
  assert.match(html,/<blockquote>/);assert.match(html,/<code>singletrack<\/code>/);
});

test('plain notes retain paragraph boundaries and single line breaks',()=>{
  assert.equal(descriptionMarkdown('First line\nSecond line\n\nNext paragraph'),'<p>First line\nSecond line</p>\n<p>Next paragraph</p>');
  assert.equal(descriptionMarkdown(null),'');
  assert.equal(descriptionMarkdown('  \n  '),'');
});

test('stored descriptions cannot inject HTML or executable link protocols',()=>{
  const html=descriptionMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[Click](javascript:alert%281%29)\n\n[Encoded](java&#x73;cript:alert%281%29)\n\n[Data](data:text/html,test)\n\n[Safe](https://example.org/"onclick="evil)');
  assert.ok(!/<(?:script|img)\b/i.test(html));
  assert.match(html,/&lt;script&gt;/);
  assert.ok(!/href="(?:javascript|data):/i.test(html));
  assert.ok(!/"onclick=/i.test(html));
});
