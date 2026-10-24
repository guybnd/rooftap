// Links the Assistant can put in a reply so the person opens an item
// straight from the chat. Tool results carry a `link` built here, and the
// prompt lists the section pages. Every route exists on web and on the phone
// (apps/web/src/lib/assistant-links.test.ts checks both file trees).

/** One item's own screen, by kind. The id is appended. */
export const ITEM_LINK_ROUTES = {
  recipe: '/recipes/',
  checklist: '/checklists/',
  watch: '/shopper/',
  scout: '/shopper/scout/',
  listing: '/apartment/',
} as const;

export type ItemLinkKind = keyof typeof ITEM_LINK_ROUTES;

/** The route that opens one item, e.g. `/recipes/<id>`. */
export function itemLink(kind: ItemLinkKind, id: string): string {
  return `${ITEM_LINK_ROUTES[kind]}${encodeURIComponent(id)}`;
}

/** Section pages the Assistant may link when an item has no screen of its own. */
export const SECTION_LINKS: { label: string; href: string }[] = [
  { label: 'Tasks', href: '/tasks' },
  { label: 'Calendar', href: '/calendar' },
  { label: 'Groceries', href: '/groceries' },
  { label: 'Costs', href: '/costs' },
  { label: 'Recipes', href: '/recipes' },
  { label: 'Checklists', href: '/checklists' },
  { label: 'Shopper', href: '/shopper' },
  { label: 'Occasions', href: '/occasions' },
  { label: 'Rewards', href: '/rewards' },
  { label: 'Documents', href: '/documents' },
  { label: 'Bin night', href: '/bins' },
  { label: 'Home Setup', href: '/setup' },
  { label: 'Home Search', href: '/homesearch' },
];

/** The prompt lines on links, for channels that open in-app routes. */
export function linksPromptText(): string {
  return (
    '## Links\n' +
    'When a tool result has a `link`, give it as a Markdown link in your reply so the person can open the item ' +
    'straight away, for example "Saved [Cabbage salad](/recipes/<id>) to your recipes." For something with no ' +
    `link of its own, you may link its section: ${SECTION_LINKS.map((s) => `[${s.label}](${s.href})`).join(', ')}. ` +
    'Never make up any other link into the app.'
  );
}
