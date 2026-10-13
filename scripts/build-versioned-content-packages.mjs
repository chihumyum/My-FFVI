import {publishContentPackages} from './content-package-pipeline.mjs';
if(process.argv.length!==2)throw new Error('Use build-versioned-content-packages.mjs without arguments');
const report=await publishContentPackages();
console.log(JSON.stringify({result:report.result,published:report.published,packages:report.packages,
  indexedMaps:report.indexedMaps,report:'build/reports/versioned-content-package-build.json',fullGameMigration:false}));
