import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
(globalThis as any).window = {};
const {api} = await import('../../../src/shared/api/client');
const originalList = api.listFiles;
afterEach(() => {api.listFiles = originalList;});
function entries(count: number) {
  return Array.from({length:count},(_,i)=>({name:`${i}.txt`,path:`/project/${i}.txt`,kind:'file' as const,size:0,mtime:''}));
}
test('directory listing includes entries after the first page in order', async()=>{
  const files=entries(1250), offsets:number[]=[];
  api.listFiles=async(path,offset=0,limit=500)=>{assert.equal(path,'/project');offsets.push(offset);return {entries:files.slice(offset,offset+limit)};};
  assert.deepEqual((await api.listAllFiles('/project')).entries,files);
  assert.deepEqual(offsets,[0,500,1000]);
});
test('an exact page boundary terminates with an empty page', async()=>{
  const files=entries(500),offsets:number[]=[];
  api.listFiles=async(_path,offset=0,limit=500)=>{offsets.push(offset);return {entries:files.slice(offset,offset+limit)};};
  assert.equal((await api.listAllFiles('/project')).entries.length,500);
  assert.deepEqual(offsets,[0,500]);
});
test('workspace cancellation discards an in-flight page and stops pagination', async()=>{
  let current=true, calls=0;
  api.listFiles=async()=>{calls++;current=false;return {entries:entries(500)};};
  await assert.rejects(api.listAllFiles('/project',()=>current),{name:'AbortError'});
  assert.equal(calls,1);
});
test('a failed later page rejects the listing instead of returning partial entries', async()=>{
  api.listFiles=async(_path,offset=0)=>{if(offset)throw new Error('connection lost');return {entries:entries(500)};};
  await assert.rejects(api.listAllFiles('/project'),/connection lost/);
});
