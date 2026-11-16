// @vitest-environment happy-dom
import {afterEach,expect,it} from 'vitest';
import {cleanup,fireEvent,render} from '@testing-library/react';
import {ImagePreview} from '../src/components/image-preview';
import type {Job} from '../src/core/schema';
afterEach(cleanup);
it('hides a failed thumbnail without hiding the full image and recovers on load',()=>{
 const job={id:'thumbnail-failure',prompt:'A circle',width:640,height:480,status:'done',blobKey:'image'} as Job;
 const {container}=render(<ImagePreview job={job} neighbors={[]}/>);
 const thumbnail=container.querySelector<HTMLImageElement>('.preview-small')!;
 const full=container.querySelector<HTMLImageElement>('.preview-full')!;
 fireEvent.error(thumbnail);expect(thumbnail.style.visibility).toBe('hidden');
 fireEvent.load(full);expect(full.classList.contains('loaded')).toBe(true);expect(full.style.visibility).not.toBe('hidden');
 fireEvent.load(thumbnail);expect(thumbnail.style.visibility).toBe('visible');
});
