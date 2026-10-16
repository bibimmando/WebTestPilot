"""Bounded, read-only DOM facts; no site routes, selectors, or business verdicts."""
STATE_JS = r"""() => {
 const visible = e => !!e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
 const root = document.querySelector('main,[role=main]') || document.body;
 const text = e => (e.innerText || e.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim();
 let clipped = 0;
 const short = s => { if(s.length > 240) clipped++; return s.slice(0,240); };
 const all = Array.from(root.querySelectorAll('article,li,tr,[role=listitem],[role=row],[itemscope]')).filter(visible);
 const links = Array.from(root.querySelectorAll('a[href]')).filter(visible);
 const numbers = Array.from(document.querySelectorAll('input[type=number],[role=spinbutton],output,[aria-live],[role=status],button,a')).filter(e => visible(e) &&
   (e.matches('input[type=number],[role=spinbutton],output,[aria-live],[role=status]') || /\d/.test(text(e) + (e.getAttribute('aria-label') || ''))));
 const rows = all.slice(0,80).map(e => ({tag:e.tagName.toLowerCase(), role:e.getAttribute('role'),
   text:short(text(e)), links:Array.from(e.querySelectorAll('a[href]')).slice(0,8).map(a=>({href:a.href,text:short(text(a))}))}));
 return {schema_version:'dom_state/1', url:location.href, scope:root === document.body ? 'body' : 'main',
   capture:'read_only_after_core_dom', completeness:'bounded_dom_candidates_not_business_inventory',
   candidates:{total:all.length,items:rows},
   links:{total:links.length,items:links.slice(0,120).map(a=>({href:a.href,text:short(text(a)),has_image:!!a.querySelector('img')}))},
   numeric_and_status:{total:numbers.length,items:numbers.slice(0,100).map(e=>({tag:e.tagName.toLowerCase(),role:e.getAttribute('role'),
      label:e.getAttribute('aria-label'),text:short(text(e)),value:e.matches('input[type=number]')?e.value:null,
      aria_value:e.getAttribute('aria-valuenow'),min:e.getAttribute('min'),max:e.getAttribute('max')}))},
   omitted:{candidate_rows:Math.max(0,all.length-80),links:Math.max(0,links.length-120),numeric_and_status:Math.max(0,numbers.length-100),
      clipped_strings:clipped,iframes:document.querySelectorAll('iframe').length,shadow_roots:'not_collected',virtualized_items:'unknown'},
   warning:'Counts describe DOM candidates, may overlap or include nested rows. Do not equate them to business item counts or infer absence from omissions.'};
}"""
