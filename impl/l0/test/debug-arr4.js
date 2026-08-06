import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>');
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, Node: dom.window.Node,
  Element: dom.window.Element, CharacterData: dom.window.CharacterData,
  HTMLInputElement: dom.window.HTMLInputElement,
  HTMLImageElement: dom.window.HTMLImageElement,
  HTMLAnchorElement: dom.window.HTMLAnchorElement,
  MutationObserver: dom.window.MutationObserver,
});
const so = await import('../src/stamp-origin.js');

// Wrap stampOrigin to trace
const orig = so.stampOrigin;
so.stampOrigin = function(obj, sourceId, path = [], visited = new WeakSet()) {
  const isArr = Array.isArray(obj);
  console.log('stampOrigin called:', isArr ? `[array len=${obj.length}]` : `{${Object.keys(obj).slice(0,3).join(',')}}`, 'path=', JSON.stringify(path), 'in visited?', visited.has(obj));
  return orig.call(this, obj, sourceId, path, visited);
};

const data = { items: [{ id: 1, name: 'Item-1' }, { id: 2, name: 'Item-2' }] };
console.log('=== Outer call ===');
so.stampOrigin(data, 'GET /arr');
