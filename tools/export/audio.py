"""Direct bank-to-FLAC compatibility export; step 3 replaces delivery with Opus.

Cache keys bind bank bytes and decoder version; original bank bytes stay in the
export's raw-media directory. No previous project output is read.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
from sab import environment_program


def export(out):
    for tool in ['vgmstream-cli', 'ffmpeg']:
        if not shutil.which(tool):
            raise RuntimeError(f'Missing {tool}; install vgmstream and ffmpeg before export')
    tables = json.loads((out/'raw/tables.json').read_text())
    media = json.loads((out/'raw/media.json').read_text())
    banks = {path.lower(): row for row in media['audio'] for path in row['source'].get('assetPaths', [row['source'].get('assetPath')]) if path}
    decoder = json.loads(subprocess.run(['vgmstream-cli','-V'],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT).stdout)['version']
    ffmpeg_version = subprocess.check_output(['ffmpeg','-version'],text=True).splitlines()[0]
    helpers = Path(__file__).read_bytes() + Path(__file__).with_name('sab.py').read_bytes()
    profile = decoder.encode() + ffmpeg_version.encode() + hashlib.sha256(helpers).digest() + b'flac-v1'
    requests = []
    for kind, name in [('bgm','bgm_asset.csv'),('se','se_asset.csv')]:
        for row in tables.get(name,[]):
            asset = row['asset_name']
            if kind == 'bgm':
                location = f"Assets/GameAssets/Serial/Res/Audio/{row['bgm_name']}/{Path(asset).stem}.win.mab.bytes"
            else:
                location = f"Assets/GameAssets/Common/Res/Audio/{row['se_name']}/{asset}.bytes"
            bank = banks.get(location.lower())
            if not bank:
                raise ValueError(f'Missing original audio bank {location}')
            requests.append((kind,row,bank))
    def decode(request):
        kind,row,bank = request
        source=out/bank['url']
        key=hashlib.sha256(source.read_bytes()+profile).hexdigest()
        cache=out/'.cache/audio'/f'{key}.json'
        if cache.exists():
            result=json.loads(cache.read_text())
            if (out/result['relative']).exists():
                return kind,row['id'],result
        temporary=tempfile.TemporaryDirectory(prefix='ffvi-bank-')
        bank_file=Path(temporary.name)/('source.mab' if kind=='bgm' else 'source.sab')
        shutil.copyfile(source,bank_file)
        metadata=json.loads(subprocess.check_output(['vgmstream-cli','-m','-I',str(bank_file)],text=True))
        program={}
        if kind=='se':
            try:
                program=environment_program(source.read_bytes())
                program.pop('program',None)
            except ValueError as error:
                program={'warning':f'SAB mixer not fully interpreted: {error}; first decoded stream retained.'}
        relative=f'audio/{key}.flac'
        target=out/relative
        target.parent.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='ffvi-audio-') as directory:
            wav=Path(directory)/'source.wav'
            subprocess.run(['vgmstream-cli','-i','-W','1','-o',str(wav),str(bank_file)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
            subprocess.run(['ffmpeg','-v','error','-y','-i',str(wav),'-map_metadata','-1','-c:a','flac','-compression_level','5',str(target)],check=True)
        result={'relative':relative,'file':'/web-data/'+relative,'sampleRate':metadata['sampleRate'],'frames':metadata['numberOfSamples'],'channels':metadata['channels'],'loop':metadata['loopingInfo'],'assetName':row['asset_name'],**program}
        temporary.cleanup()
        cache.parent.mkdir(parents=True,exist_ok=True)
        cache.write_text(json.dumps(result)+'\n')
        return kind,row['id'],result
    result={'bgm':{'tracks':{}},'se':{'tracks':{}},'environment':{'tracks':{}}}
    with ThreadPoolExecutor(max_workers=4) as pool:
        for index,(kind,id,track) in enumerate(pool.map(decode,requests)):
            result[kind]['tracks'][id]={key:value for key,value in track.items() if key!='relative'}
            if kind=='se': result['environment']['tracks'][id]=result[kind]['tracks'][id]
            if (index+1)%100==0:print(f'Audio {index+1}/{len(requests)}',flush=True)
    used = {track['file'].removeprefix('/web-data/') for catalog in result.values() for track in catalog['tracks'].values()}
    for file in (out/'audio').glob('*.flac'):
        if file.relative_to(out).as_posix() not in used:
            file.unlink()
    (out/'audio.json').write_text(json.dumps(result,separators=(',',':'))+'\n')
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--out',required=True,type=Path)
    args=parser.parse_args()
    export(args.out)
