import { expect, it } from "vitest";
import { jobRecovery } from "../src/core/job-recovery";
it("allows correcting invalid references before generation but not blind uncertain retries",()=>{
 expect(jobRecovery({status:"blocked",error:"A required reference is not a supported PNG, JPEG or WebP image"})).toMatchObject({automaticRetryAllowed:true,action:"repair_references"});
 expect(jobRecovery({status:"uncertain",error:"reference missing"})).toMatchObject({automaticRetryAllowed:false,action:"inspect_result"});
 expect(jobRecovery({status:"done"})).toBeUndefined();
});

it("distinguishes a generated size mismatch from an unknown generation outcome",()=>{
 expect(jobRecovery({status:"uncertain",error:"The generated image is too small for the requested size without upscaling"})).toMatchObject({action:"inspect_size_mismatch",generationCompleted:true,automaticRetryAllowed:false});
 expect(jobRecovery({status:"blocked",error:"The generated image was saved, but could not be fitted to the requested dimensions without upscaling."})).toMatchObject({generationCompleted:true});
});
