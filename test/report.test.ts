import { describe, expect, it } from 'vitest';
import { untrusted } from '../src/report.js';

// PR bodies quote model output, which is derived from web pages.
describe('untrusted text in the PR body', () => {
  it('neutralises mentions, images, hidden links and HTML but keeps text readable', () => {
    const out = untrusted('Žr. @someone ![x](https://t.example/p.png) [spausk](https://evil.example) <img src=x> https://ok.lt/a');
    expect(out).not.toMatch(/@[A-Za-z]/);
    expect(out).not.toMatch(/!\[/);
    expect(out).not.toMatch(/\]\(/);
    expect(out).not.toMatch(/<img/);
    expect(out).toContain('https://ok.lt/a');
    expect(out.replace(/​/g, '')).toContain('[spausk](https://evil.example)');
  });
});
