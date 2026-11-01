import { run } from './run.ts';

const code = await run(process.argv.slice(2));
process.exit(code);
