import {publishContentPackages} from './content-package-pipeline.mjs';
const args=process.argv.slice(2);
if(args.length&&(args.length!==2||args[0]!=='--source-selection'||!args[1]||args[1].startsWith('--')))
  throw new Error('Use build-versioned-content-packages.mjs [--source-selection content-batches/<selection>.json]');
const report=await publishContentPackages(args.length?{sourceSelectionPath:args[1]}:{});
console.log(JSON.stringify({result:report.result,published:report.published,packages:report.packages,
  indexedMaps:report.indexedMaps,sourceSelection:report.sourceSelection,
  report:'build/reports/versioned-content-package-build.json',fullGameMigration:false}));
