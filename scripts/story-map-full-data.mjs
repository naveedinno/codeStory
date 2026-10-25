// THROWAWAY: navigation over the original story; never rewrites authored steps.
import { narrativeText } from '../dist/narrative.js';
const SECTION_STARTS = [
  ["The map and the diamond's router", 'Map, routing and storage'],
  ['Roles and whom a call acts for', 'Roles and signed calls'],
  ['Pockets and the balanced call', 'Ledger and buckets'],
  ['Intent and fill handshake', 'Trading'],
  ['Suspension and account clearing', 'Clearing and disputes'],
  ['Option schemas and the options hook', 'Options and position tokens'],
  ['Invariants that close the tour', 'Closing invariants'],
];
const excerpt = text => { const plain = narrativeText(text); const first = plain.split(/(?<=[.!?])\s/)[0]; return first.length <= 90 ? first : first.slice(0, 87).replace(/\s+\S*$/, '') + '…'; };
export function fullStoryMap(tour) {
  const steps = [...tour.steps].sort((a,b) => a.order-b.order), nodes = [], viewers = new Map();
  const root = { id:'root', stepId:'map-root', panelIndex:1, label:tour.title, symbol:`${steps.length} steps`, beat:0, beats:0, structural:'tour', children:[], content:[{type:'prose',text:narrativeText(tour.summary ?? '')}] };
  nodes.push(root);
  const chapters = [...new Set(steps.map(step => step.chapter || 'Story'))];
  const sections = SECTION_STARTS.every(([name]) => chapters.includes(name)) ? SECTION_STARTS : [[chapters[0], 'Story chapters']];
  let section;
  for (const [chapterIndex, chapter] of chapters.entries()) {
    const authored = steps.filter(step => (step.chapter || 'Story') === chapter), first = steps.indexOf(authored[0]) + 1;
    const start = sections.find(([name]) => name === chapter);
    if (start || !section) {
      section = {id:`section-${chapterIndex}`,stepId:`section-${chapterIndex}`,panelIndex:first,label:start?.[1] || 'Story chapters',symbol:'',beat:0,beats:0,structural:'section',children:[],content:[]};
      nodes.push(section);root.children.push(section.id);
    }
    const group = {id:`chapter-${chapterIndex}`,stepId:`chapter-${chapterIndex}`,panelIndex:first,label:chapter,symbol:`${authored.length} ${authored.length === 1 ? 'step' : 'steps'}`,beat:0,beats:0,structural:'chapter',children:[],content:[{type:'prose',text:`${authored.length} ${authored.length === 1 ? 'step' : 'steps'} in this chapter.`}]};
    nodes.push(group);section.children.push(group.id);
    for (const step of authored) {
      const panelIndex = steps.indexOf(step)+1, viewerId = `story-${step.id}`;
      const content = step.kind === 'concept' ? [] : [{type:'text',panelIndex,beat:0}];
      content.push(step.kind === 'concept' ? {type:'page',viewerId,panelIndex} : {type:'code',viewerId,file:step.file,revision:tour.head,rangesByBeat:(step.beats??[]).map(beat=>beat.highlights??[])});
      const node = {id:step.id,stepId:step.id,panelIndex,label:narrativeText(step.title),symbol:step.landing?.symbol || (step.kind==='concept'?'':step.file),beat:0,beats:step.beats?.length ?? 0,children:[],content};
      viewers.set(viewerId,panelIndex-1);nodes.push(node);group.children.push(node.id);
      for (const [beat, passage] of (step.beats??[]).entries()) if (beat > 0) {
        const id=`${step.id}-beat-${beat}`;node.children.push(id);
        nodes.push({...node,id,label:excerpt(passage.text),beat,children:[],content:[{type:'text',panelIndex,beat}]});
      }
    }
  }
  for (const part of nodes.filter(node=>node.structural==='section')) {
    const groups=part.children.map(id=>nodes.find(node=>node.id===id));
    part.symbol=`${groups.length} ${groups.length === 1 ? 'chapter' : 'chapters'}`;part.content=[{type:'prose',text:groups.map(group=>group.label).join(' · ')}];
  }
  root.symbol=`${steps.length} steps · ${chapters.length} chapters`;
  return { data:{nodes,commit:tour.head,title:tour.title,sourceStory:null,path:steps.map(step=>step.id),scope:'full',rootLabel:'Full tour',readingLabel:'Whole tour'}, viewers };
}
