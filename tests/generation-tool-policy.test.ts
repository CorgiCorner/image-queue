import{expect,it}from'vitest';import{verifyGenerationToolPolicy}from'../src/core/generation-tool-policy';
it('allows only image generation and reference inspection',()=>{expect(verifyGenerationToolPolicy({servers:[],builtins:['image_gen','view_image']})).toBe(true);});
it('rejects effective external tools even when their config claimed disabled',()=>{expect(()=>verifyGenerationToolPolicy({servers:[{name:'plugin',tools:{send_message:{}}}],builtins:['image_gen']})).toThrow('isolation');});
it('rejects shell, web and absent generation',()=>{for(const builtins of [['image_gen','exec_command'],['image_gen','web_search'],['view_image']])expect(()=>verifyGenerationToolPolicy({servers:[],builtins})).toThrow();});
