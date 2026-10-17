// Reuse the existing whole-source Session/directory observer. No second engine
// or producer; all 53 source programs and 490 party requests remain in scope.
const args=process.argv.slice(2);if(args.includes('--family'))throw new Error('The effect family is fixed by this entry');
process.argv.push('--family','effects');if(!args.includes('--report'))process.argv.push('--report','build/reports/battle-event-effects/check.json');
await import('./check-battle-event-messages.mjs');
