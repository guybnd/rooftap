import { defineModule } from '../../module-manifest';

export const mcpModule = defineModule({
  id: 'mcp',
  label: 'AI assistants (MCP)',
  description: 'Lets an AI assistant read and update your household through MCP.',
  iconId: 'bot',
  defaultEnabled: false,
  enhances: ['household', 'calendar', 'costs', 'groceries'],
  noTools: 'The door outside AI assistants use to reach the household tools. It holds no household data of its own.',
});
