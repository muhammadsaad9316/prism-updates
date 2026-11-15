// Repository-native publisher: GITHUB_TOKEN is scoped to this updates repository.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export const repository='muhammadsaad9316/prism-updates';
export const certificate='306c50c5d90664e524dd89ad77b86f9bfed215b40e90337a02c3d0f1f47f4313';
const base=`https://raw.githubusercontent.com/${repository}/main/`;
export function verifyPayload(manifest,bytes,versionName,versionCode){
 if(!Number.isSafeInteger(versionCode)||versionCode<1||versionCode>2100000000||!/^\d+\.\d+\.\d+$/.test(versionName)||manifest.schema!==1||manifest.packageName!=='app.prism.labcontroller'||manifest.versionName!==versionName||manifest.versionCode!==versionCode||manifest.certificateSha256!==certificate||manifest.apkUrl!==`${base}releases/${versionCode}/prism.apk`||bytes.length<1||bytes.length>33554432||manifest.size!==bytes.length||manifest.sha256!==createHash('sha256').update(bytes).digest('hex'))throw Error('APK release metadata, checksum or signer binding is invalid');
}
function github(method,path,body){
 try{return JSON.parse(execFileSync('gh',['api',`repos/${repository}/${path}`,'--method',method,...(body?['--input','-']:[])],{input:body?JSON.stringify(body):undefined,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:120000,maxBuffer:33554432}));}
 catch(error){if(method==='GET'&&/HTTP 404/.test(String(error.stderr)))return null;throw Error('GitHub update repository operation failed; the existing feed was not force-replaced.');}
}
export async function publishPayload(manifest,bytes,api=github){
 const head=await api('GET','git/ref/heads/main');if(!head?.object?.sha)throw Error('Update branch is unavailable');
 const parent=head.object.sha,commit=await api('GET',`git/commits/${parent}`);
 const existing=await api('GET',`contents/latest.json?ref=${parent}`);
 if(existing){const old=JSON.parse(Buffer.from(existing.content,'base64').toString('utf8'));if(!Number.isSafeInteger(old.versionCode)||old.versionCode>manifest.versionCode||old.versionCode===manifest.versionCode&&old.sha256!==manifest.sha256)throw Error('Refusing a release downgrade or replacement');}
 const path=`releases/${manifest.versionCode}/prism.apk`,published=await api('GET',`contents/${path}?ref=${parent}`),blobHash=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
 if(published&&published.sha!==blobHash)throw Error('Refusing to replace an existing APK');
 const tree=[];for(const [name,value] of [[path,bytes],['latest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n')]]){const blob=await api('POST','git/blobs',{content:value.toString('base64'),encoding:'base64'});tree.push({path:name,mode:'100644',type:'blob',sha:blob.sha});}
 const nextTree=await api('POST','git/trees',{base_tree:commit.tree.sha,tree});
 const next=await api('POST','git/commits',{message:`Publish Prism ${manifest.versionName} (${manifest.versionCode})`,tree:nextTree.sha,parents:[parent]});
 await api('PATCH','git/refs/heads/main',{sha:next.sha,force:false});return next.sha;
}
async function main(){
 if(process.env.GITHUB_REPOSITORY!==repository)throw Error('Publisher must run in the updates repository');
 const folder=resolve(process.argv[2]),manifest=JSON.parse(await readFile(join(folder,'latest.json'),'utf8')),bytes=await readFile(join(folder,'app-release.apk'));
 verifyPayload(manifest,bytes,process.env.EXPECTED_VERSION_NAME,Number(process.env.EXPECTED_VERSION_CODE));
 const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT;if(!sdk)throw Error('Android signing verifier unavailable');
 const result=execFileSync(join(sdk,'build-tools/35.0.0/apksigner'),['verify','--print-certs',join(folder,'app-release.apk')],{encoding:'utf8'});
 if(result.match(/Signer #1 certificate SHA-256 digest:\s*([a-f0-9]+)/i)?.[1]?.toLowerCase()!==certificate)throw Error('APK signature does not match the permanent release certificate');
 const commit=await publishPayload(manifest,bytes);console.log(`Published verified Prism ${manifest.versionName}; update commit ${commit}.`);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(error.message);process.exitCode=1;});
