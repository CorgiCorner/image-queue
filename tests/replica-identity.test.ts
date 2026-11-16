import { afterEach, expect, it } from "vitest";
import { MemoryStorage } from "../src/storage/memory";
import { ImageService } from "../src/core/service";
import { createRecordIdentity, globalRecordId, replicaIdentitySchema } from "../src/core/replica-identity";
import { createTopic, pinTarget } from "../src/core/organization";
import { addNote } from "../src/core/notes";
import { compareVersions } from "../src/core/hybrid-clock";
import { png } from "./fixtures";

afterEach(()=>{delete process.env.IMAGE_QUEUE_MACHINE_ID;});
it("namespaces IDs by origin and kind while leaving local identifiers opaque",async()=>{
  const id=await globalRecordId("jobs","machine-a","IMG-test");
  expect(id).toMatch(/^G-[a-f0-9]{64}$/);
  expect(await globalRecordId("jobs","machine-a","IMG-test")).toBe(id);
  expect(await globalRecordId("jobs","machine-b","IMG-test")).not.toBe(id);
  expect(await globalRecordId("projects","machine-a","IMG-test")).not.toBe(id);
  expect(await globalRecordId("pins","machine-a",`project-${"a".repeat(128)}`)).toMatch(/^G-/);
  await expect(globalRecordId("settings" as never,"a","b")).rejects.toThrow();
  await expect(globalRecordId("jobs","../a","b")).rejects.toThrow();
  await expect(globalRecordId("jobs","a","../b")).rejects.toThrow();
});
it("persists identity metadata in new domain records and keeps idempotency stable",async()=>{
  const store=new MemoryStorage(),api=new ImageService(store);
  const project=await api.createProject("Identity");
  expect(replicaIdentitySchema.safeParse(project).success).toBe(true);
  const request={projectId:project.id,prompt:"Paint a landscape",idempotencyKey:"same-key",source:"queue" as const,provider:"openai" as const,model:"",width:1024,height:1024,transparent:false,referenceIds:[]};
  const first=await api.create(request),second=await api.create(request);
  expect(first.id).toBe("IMG-same-key");
  expect(second).toEqual(first);
  expect(first.originMachine).toBe(project.originMachine);
  expect(compareVersions(first.createdVersion!,project.createdVersion!)).toBe(1);
  expect(await store.get("jobs",first.id)).toEqual(first);
  const topic=await createTopic(store,project.id,"One");
  const note=await addNote(store,{imageId:first.id,text:"A note"});
  const ref=await api.addReference(project.id,"reference.png","image/png",png);
  const imported=await api.importImage("imported.png","image/png",png);
  for(const record of [topic,note,ref,imported.job])expect(replicaIdentitySchema.safeParse(record).success).toBe(true);
  const pin=await pinTarget(store,"project",project.id,true);
  const removed=await pinTarget(store,"project",project.id,false);
  expect(removed.globalId).toBe(pin.globalId);
  expect(removed.createdVersion).toEqual(pin.createdVersion);
});
it("separates identical local request IDs made on different machines",async()=>{
  const stores=[new MemoryStorage(),new MemoryStorage()];
  const jobs=[];
  for(const [i,store] of stores.entries()){
    await store.put("settings","machine",{id:`machine-${i}`});
    const api=new ImageService(store),p=await api.createProject("Project");
    jobs.push(await api.create({projectId:p.id,prompt:"Paint a landscape",idempotencyKey:"shared",source:"queue",provider:"openai",model:"",width:1024,height:1024,transparent:false,referenceIds:[]}));
  }
  expect(jobs[0].id).toBe(jobs[1].id);
  expect(jobs[0].globalId).not.toBe(jobs[1].globalId);
});
it("validates a configured machine identity before creating portable metadata",async()=>{
  process.env.IMAGE_QUEUE_MACHINE_ID="../not-a-machine";
  await expect(createRecordIdentity(new MemoryStorage(),"jobs","IMG-test")).rejects.toThrow();
});

it("keeps origin and creation version when organizational metadata changes",async()=>{
  const api=new ImageService(new MemoryStorage());
  const a=await api.createProject("A"),b=await api.createProject("B");
  const job=await api.create({projectId:a.id,prompt:"A study",idempotencyKey:"move",source:"queue",provider:"openai",model:"",width:1024,height:1024,referenceIds:[],transparent:false});
  await api.moveJob(job.id,b.id);
  const moved=await api.store.get<typeof job>("jobs",job.id);
  expect(moved?.projectId).toBe(b.id);
  expect(moved?.globalId).toBe(job.globalId);
  expect(moved?.originMachine).toBe(job.originMachine);
  expect(moved?.createdVersion).toEqual(job.createdVersion);
});
