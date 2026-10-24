import { describe, expect, it } from 'vitest';
import { buildAssistantSystemPrompt, type AssistantPromptInput } from './assistant-prompt';
import { WEB_SEARCH_TOOL, cleanHere, isPrivateAddress, looksNearby, pageText, serpPlaces, serpSearchAnswer, webPageUrl } from './web-lookup';

describe('serpSearchAnswer', () => {
  it('keeps titles, links, snippets and prices', () => {
    const out = serpSearchAnswer({
      answer_box: { answer: '$49' },
      organic_results: [
        { title: 'Airmesh thong', link: 'https://example.com/a', snippet: 'From $49' },
        { title: 'No link' },
      ],
      shopping_results: [
        { title: 'Airmesh', source: 'Shop', price: '$45.00', product_link: 'https://shop.example/p' },
        { title: 'No store', price: '$1' },
      ],
    });
    expect(out.answer).toBe('$49');
    expect(out.results).toEqual([{ title: 'Airmesh thong', url: 'https://example.com/a', snippet: 'From $49' }]);
    expect(out.shopping).toEqual([{ title: 'Airmesh', store: 'Shop', url: 'https://shop.example/p', price: '$45.00' }]);
  });

  it('copes with an empty or odd body', () => {
    expect(serpSearchAnswer(null)).toEqual({ answer: null, results: [], shopping: [] });
    expect(serpSearchAnswer({ organic_results: 'x' }).results).toEqual([]);
  });
});

describe('pageText', () => {
  it('drops scripts, styles and tags and decodes entities', () => {
    const html =
      '<html><head><title>Shop &amp; Co</title><style>p{}</style></head><body><script>var x=1</script>' +
      '<h1>Airmesh</h1><p>Price: &#36;49&nbsp;AUD</p><!-- hidden --></body></html>';
    const out = pageText(html);
    expect(out.title).toBe('Shop & Co');
    expect(out.text).toBe('Airmesh\nPrice: $49 AUD');
    expect(out.cut).toBe(false);
  });

  it('cuts long pages', () => {
    const out = pageText(`<p>${'a'.repeat(50)}</p>`, 10);
    expect(out.text).toHaveLength(10);
    expect(out.cut).toBe(true);
  });
});

describe('webPageUrl', () => {
  it('takes public http(s) links', () => {
    expect(webPageUrl('https://example.com/a#b')?.toString()).toBe('https://example.com/a');
    expect(webPageUrl('http://shop.example.co.nz:443/x')).not.toBeNull();
  });

  it('refuses local, private and odd links', () => {
    for (const bad of [
      'ftp://example.com',
      'https://user:pw@example.com',
      'https://localhost/x',
      'https://router.local',
      'https://intranet',
      'https://example.com:8123/',
      'http://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/',
      'http://10.0.0.5/',
      'not a link',
      42,
    ]) {
      expect(webPageUrl(bad), String(bad)).toBeNull();
    }
  });
});

describe('isPrivateAddress', () => {
  it('knows private and public addresses', () => {
    for (const a of ['10.1.2.3', '172.16.0.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ['8.8.8.8', '172.32.0.1', '2606:4700::1111']) expect(isPrivateAddress(a), a).toBe(false);
  });
});

describe('prompt', () => {
  const base: AssistantPromptInput = { now: 'Thursday', timeZone: 'UTC', person: 'Guy', members: ['Guy'], modules: [], memories: [], kind: 'quick', channel: 'app' };
  it('names the web tools only when the server offers them', () => {
    expect(buildAssistantSystemPrompt({ ...base, web: { where: 'home' } })).toContain(WEB_SEARCH_TOOL);
    expect(buildAssistantSystemPrompt(base)).not.toContain(WEB_SEARCH_TOOL);
  });

  it('asks for a suburb, not a guess, when there is no location', () => {
    expect(buildAssistantSystemPrompt({ ...base, web: { where: null } })).toContain('Never guess a city');
    expect(buildAssistantSystemPrompt({ ...base, web: { where: 'device' } })).toContain('near them');
  });
});

describe('near me', () => {
  it('spots questions about places nearby', () => {
    for (const t of ['Can you find a nice hotdog place near me', 'any cafes nearby?', "what's the closest chemist", 'pizza around here']) {
      expect(looksNearby(t), t).toBe(true);
    }
    for (const t of ['add milk to the list', 'how much is this', 'nearly done with the chores']) expect(looksNearby(t), t).toBe(false);
  });

  it('rounds a sent position and drops a bad one', () => {
    expect(cleanHere({ lat: -37.813629, lng: 144.963058 })).toEqual({ lat: -37.814, lng: 144.963 });
    expect(cleanHere({ lat: 200, lng: 0 })).toBeNull();
    expect(cleanHere({ lat: '1', lng: 2 })).toBeNull();
    expect(cleanHere(null)).toBeNull();
  });

  it('reads Google Maps places', () => {
    expect(serpPlaces({ local_results: [{ title: 'A', rating: 4.5, reviews: 10, open_state: 'Open now' }, { address: 'x' }] })).toEqual([
      { name: 'A', address: null, type: null, rating: 4.5, reviews: 10, price: null, open: 'Open now', website: null },
    ]);
  });
});
