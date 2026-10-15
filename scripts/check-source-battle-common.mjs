// One same-candidate execution of all original bodies/parties, with separate
// message, effect, system-message and branch views of those exact observations.
if(process.argv.includes('--family'))throw new Error('The common battle family is fixed by this entry');
process.argv.push('--family','all');
await import('./check-battle-event-messages.mjs');
