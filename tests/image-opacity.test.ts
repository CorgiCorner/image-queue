import { expect, it, vi, afterEach } from "vitest";
import sharp from "sharp";
import { hasTransparentPixels } from "../src/sources/image-opacity";
afterEach(()=>vi.unstubAllEnvs());
it("does not mistake an opaque RGBA PNG for a transparent image",async()=>{
 const bytes=await sharp({create:{width:2,height:2,channels:4,background:{r:1,g:2,b:3,alpha:1}}}).png().toBuffer();
 expect(await hasTransparentPixels(bytes)).toBe(false);
});
it("detects a pixel with partial alpha",async()=>{
 const bytes=await sharp({create:{width:2,height:2,channels:4,background:{r:1,g:2,b:3,alpha:0.5}}}).png().toBuffer();
 expect(await hasTransparentPixels(bytes)).toBe(true);
});
it("does not claim verified opacity without a local decoder",async()=>{
 vi.stubEnv("IMAGE_QUEUE_STORAGE_DRIVER","cloudflare");
 expect(await hasTransparentPixels(new Uint8Array())).toBeUndefined();
});
it("returns unknown when image pixels cannot be decoded",async()=>{
 expect(await hasTransparentPixels(new Uint8Array([1,2,3]))).toBeUndefined();
});
