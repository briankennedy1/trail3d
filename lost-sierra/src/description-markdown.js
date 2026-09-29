import {micromark} from 'micromark';

// Keep stored notes as Markdown; render safely in both the guide and CMS preview.
export function descriptionMarkdown(text){
  return micromark(String(text??'').trim(),{
    allowDangerousHtml:false,
    allowDangerousProtocol:false,
  }).replace(/<a href=/g,'<a target="_blank" rel="noopener noreferrer" href=');
}

export function wireDescriptionPreview(container,textarea){
  const preview=container.querySelector('.markdown-copy');
  const render=()=>{preview.innerHTML=descriptionMarkdown(textarea.value)||'<p class="muted">Your formatted description will appear here.</p>';};
  container.addEventListener('toggle',()=>{if(container.open)render();});
  textarea.addEventListener('input',()=>{if(container.open)render();});
}
