const wall=document.querySelector('.motion-wall');
if(wall){
 const video=wall.querySelector('.motion-wall-video'),toggle=wall.querySelector('.motion-wall-toggle');
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 let userPaused=reduced,visible=false;
 video.addEventListener('playing',()=>wall.classList.add('is-playing'),{once:true});
 video.addEventListener('error',()=>wall.classList.add('no-video'),{once:true});
 function updateButton(){toggle.innerHTML=userPaused?'Play <span aria-hidden="true">▶</span>':'Pause <span aria-hidden="true">Ⅱ</span>';toggle.setAttribute('aria-label',userPaused?'Play motion showcase':'Pause motion showcase')}
 function updatePlayback(){if(visible&&!userPaused&&!document.hidden)video.play().catch(()=>{userPaused=true;updateButton()});else video.pause()}
 toggle.addEventListener('click',()=>{userPaused=!userPaused;updateButton();updatePlayback()});
 if('IntersectionObserver'in window){new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;updatePlayback()},{threshold:.1}).observe(wall)}else{visible=true;updatePlayback()}
 document.addEventListener('visibilitychange',updatePlayback);updateButton();
}
