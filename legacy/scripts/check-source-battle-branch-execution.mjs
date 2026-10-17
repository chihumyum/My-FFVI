// Same candidate/shared Session path, all source bodies and original parties.
import{spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';
const r=spawnSync(process.execPath,[fileURLToPath(new URL('./check-battle-event-messages.mjs',import.meta.url)),'--family','branch-execution',...process.argv.slice(2)],{stdio:'inherit'});if(r.error)throw r.error;process.exitCode=r.status??1;
