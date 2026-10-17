// Same-runtime complete source programs/party directory, never a new producer.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const run=spawnSync(process.execPath,[fileURLToPath(new URL('./check-battle-event-messages.mjs',import.meta.url)),'--family','system-messages',...process.argv.slice(2)],{stdio:'inherit'});
if(run.error)throw run.error;process.exitCode=run.status??1;
