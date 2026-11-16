import { expect, it } from "vitest";
import { jobRecovery } from "../src/core/job-recovery";
it("allows correcting invalid references before generation but not blind uncertain retries",()=>{
 expect(jobRecovery({status:"blocked",error:"A required reference is not a supported PNG, JPEG or WebP image"})).toMatchObject({automaticRetryAllowed:true,action:"repair_references"});
 expect(jobRecovery({status:"uncertain",error:"reference missing"})).toMatchObject({automaticRetryAllowed:false,action:"inspect_result"});
 expect(jobRecovery({status:"done"})).toBeUndefined();
});
