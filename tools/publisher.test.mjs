import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyPayload,publishPayload,certificate} from './publish-apk.mjs';
const bytes=Buffer.from('synthetic test only, not an APK download');
const manifest={schema:1,packageName:'app.prism.labcontroller',versionName:'3.0.25',versionCode:302501,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),certificateSha256:certificate,apkUrl:'https://raw.githubusercontent.com/muhammadsaad9316/prism-updates/main/releases/302501/prism.apk'};
test('Metadata, content hash, fixed signer and exact source version must match',()=>{
 assert.doesNotThrow(()=>verifyPayload(manifest,bytes,'3.0.25',302501));for(const patch of [{packageName:'another.app'},{versionCode:302502},{versionName:'3.0.26'},{size:1},{sha256:'0'.repeat(64)},{certificateSha256:'0'.repeat(64)},{apkUrl:'https://example.invalid/app.apk'}])assert.throws(()=>verifyPayload({...manifest,...patch},bytes,'3.0.25',302501),/invalid/);
});
function fake(old={versionCode:102401,sha256:'old'}){const calls=[];return {calls,api:async(method,path,body)=>{calls.push({method,path,body});if(path==='git/ref/heads/main')return {object:{sha:'parent'}};if(path==='git/commits/parent')return {tree:{sha:'original-tree'}};if(path==='contents/latest.json?ref=parent')return {content:Buffer.from(JSON.stringify(old)).toString('base64')};if(path.startsWith('contents/releases/'))return null;if(path==='git/blobs')return {sha:'blob'+calls.length};if(path==='git/trees')return {sha:'new-tree'};if(path==='git/commits')return {sha:'new-commit'};if(path==='git/refs/heads/main')return {};throw Error(path);}};}
test('Publication updates only the APK and feed atomically without force',async()=>{const f=fake();assert.equal(await publishPayload(manifest,bytes,f.api),'new-commit');const tree=f.calls.find(c=>c.path==='git/trees').body;assert.deepEqual(tree.tree.map(item=>item.path),['releases/302501/prism.apk','latest.json']);assert.deepEqual(f.calls.at(-1),{method:'PATCH',path:'git/refs/heads/main',body:{sha:'new-commit',force:false}});});
test('A newer feed prevents all repository writes',async()=>{const f=fake({versionCode:999999,sha256:'new'});await assert.rejects(publishPayload(manifest,bytes,f.api),/downgrade/);assert.equal(f.calls.some(c=>c.method!=='GET'),false);});
