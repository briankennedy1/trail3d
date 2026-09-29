// Keep one painted frame until its replacement is ready. A newer selection
// owns the frame even when an older, aborted load finishes later.
export class FrameHandoff{
  constructor(host){this.host=host;this.current=null;this.animation=null;this.revision=0;}
  hold(snapshot=null){
    this.revision++;this.animation?.cancel();this.animation=null;
    if(snapshot&&snapshot!==this.current){
      this.current?.frame.remove();this.current=snapshot;
      snapshot.frame.className='ride-transition-frame';this.host.append(snapshot.frame);
    }
    return this.current;
  }
  async reveal(reduced=false){
    const snapshot=this.current,revision=this.revision;if(!snapshot)return;
    if(!reduced){
      this.animation=snapshot.frame.animate([{opacity:1},{opacity:0}],{duration:360,easing:'cubic-bezier(.22,1,.36,1)',fill:'forwards'});
      await this.animation.finished.catch(()=>{});
    }
    if(revision!==this.revision)return;
    snapshot.frame.remove();this.current=null;this.animation=null;
  }
}
