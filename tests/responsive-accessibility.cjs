const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const f=path.resolve(root,decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '')||'index.html');if(!f.startsWith(root+path.sep)||!fs.existsSync(f)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript'})[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
 try{for(const [width,height] of [[360,800],[390,844],[412,915],[768,1024],[820,1180],[1024,768],[1366,768]])for(const theme of ['light','dark']){
 const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>(r.request().url().startsWith(url)||(process.env.TEST_EXTERNAL_ASSETS==='1' && /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//.test(r.request().url())))?r.continue():r.abort());await page.goto(url);await page.evaluate(t=>applyTheme(t),theme);await page.evaluate(()=>document.fonts.ready);
 await page.addStyleTag({content:'*{animation-duration:0s!important;transition-duration:0s!important;scroll-behavior:auto!important}'});
 const layout=await page.evaluate(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right}};return {controls:[...document.querySelectorAll('.search-input-group .search-input,.search-input-group > button')].map(rect),campus:[...document.querySelectorAll('#page-home .campus-btn')].map(rect),stats:[...document.querySelectorAll('.stat-card')].map(rect),overflow:document.documentElement.scrollWidth>innerWidth,brand:rect(document.querySelector('.brand-logo')),actions:rect(document.querySelector('.header-actions')),padding:parseFloat(getComputedStyle(document.querySelector('.main-wrapper')).paddingBottom)};});
 assert.equal(layout.overflow,false);assert.ok(layout.brand.right<=layout.actions.x+1,'header overlap');assert.ok(layout.padding<=40);
 if(width<=1024){assert.equal(layout.controls.length,3);for(const c of layout.controls){assert.ok(Math.abs(c.x-layout.controls[0].x)<1,'search left');assert.ok(Math.abs(c.w-layout.controls[0].w)<1,'search width');assert.equal(c.h,48,'control height');}assert.equal(layout.campus[0].h,layout.campus[1].h);if(width<=600){assert.equal(layout.campus[0].w,layout.campus[1].w);assert.ok(layout.campus[1].y>layout.campus[0].y);}else assert.equal(layout.campus[0].y,layout.campus[1].y);}
 if(width<=820){assert.equal(layout.stats.length,4);assert.equal(layout.stats[0].y,layout.stats[1].y);assert.ok(layout.stats[2].y>layout.stats[0].y);for(const s of layout.stats)assert.equal(s.h,layout.stats[0].h);}
 await page.screenshot({path:`test-results/responsive-${width}-${theme}-home.png`,fullPage:false});
 if(width<=1024){await page.locator('.nav-toggle').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.nav-toggle').getAttribute('aria-expanded'),'true');assert.ok(await page.locator('#mobile-menu-drawer').evaluate(e=>e.contains(document.activeElement)));await page.keyboard.press('Shift+Tab');assert.ok(await page.locator('#mobile-menu-drawer').evaluate(e=>e.contains(document.activeElement)));await page.keyboard.press('Escape');await page.waitForTimeout(30);assert.ok(await page.locator('.nav-toggle').evaluate(e=>e===document.activeElement));}
 await page.evaluate(()=>navigateToPage('routes'));await page.locator('#routes-detail-container .route-card').first().getByRole('button',{name:/View Full Route/}).click();
 assert.equal(await page.locator('#routes-detail-container .route-card').count(),0);assert.ok(await page.locator('#route-schedule-controls').isHidden());assert.ok(await page.locator('.route-back-button').evaluate(e=>e===document.activeElement));
 const timeline=await page.evaluate(()=>[...document.querySelectorAll('.schedule-timeline .timeline-item')].map(e=>{const r=e.getBoundingClientRect(),m=e.querySelector('.timeline-marker').getBoundingClientRect(),c=e.querySelector('.timeline-stop-content').getBoundingClientRect(),b=getComputedStyle(e,'::before'),a=getComputedStyle(e,'::after');return {axis:m.x+m.width/2,line:r.x+parseFloat(b.left)+1,diameter:m.width,content:c.x,markerRight:m.right,before:b.display,after:a.display,right:r.right};}));
 for(const t of timeline){assert.ok(Math.abs(t.axis-t.line)<.1,'line axis');assert.equal(t.axis,timeline[0].axis);assert.equal(t.diameter,16);assert.ok(t.content>t.markerRight);assert.ok(t.right<=width);}assert.equal(timeline[0].before,'none');assert.equal(timeline.at(-1).after,'none');
 await page.screenshot({path:`test-results/responsive-${width}-${theme}-detail.png`,fullPage:true});
 const print=page.getByRole('button',{name:'Print / Download',exact:true});await print.focus();await page.keyboard.press('Enter');assert.ok(await page.locator('#print-modal').evaluate(e=>e.contains(document.activeElement)));for(let i=0;i<6;i++){await page.keyboard.press('Tab');assert.ok(await page.locator('#print-modal').evaluate(e=>e.contains(document.activeElement)));}await page.keyboard.press('Escape');await page.waitForTimeout(30);assert.ok(await print.evaluate(e=>e===document.activeElement));
 await page.evaluate(()=>navigateToPage('notices'));const faq=page.locator('button.faq-header').first();await faq.focus();await page.keyboard.press('Enter');assert.equal(await faq.getAttribute('aria-expanded'),'true');await page.keyboard.press('Space');assert.equal(await faq.getAttribute('aria-expanded'),'false');
 for(const section of ['routes','favorites','contact','home']){await page.evaluate(s=>navigateToPage(s),section);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),section+' overflow');}

 // Exercise the actual search-result timeline shown in the reported screenshot.
 await page.evaluate(()=>{
  const route=UET_DATA.routes.find(r=>r.stops[0].name==='Flat Stop');
  const stopIndex=2, stop=route.stops[stopIndex];
  appState.selectedCampus=route.campusId;
  appState.recommendationResults={status:'within_radius',matchingRoutes:[{route,stop,stopIndex,distanceKm:.1}],allNearby:[],userLat:stop.lat,userLng:stop.lng,locationLabel:'Timeline regression',targetCampus:route.campusId};
  appState.activeRecommendationIndex=0;renderResultPage();navigateToPage('result');
 });
 const resultTimeline=page.locator('#page-result .stops-timeline');
 await resultTimeline.waitFor();
 for(const hover of [false,true]){
  if(hover)await resultTimeline.locator('.nearest').hover();
  const rows=await resultTimeline.locator('.timeline-item').evaluateAll(items=>items.map(e=>{
   const r=e.getBoundingClientRect(),m=e.querySelector('.timeline-marker').getBoundingClientRect(),c=e.querySelector('.timeline-stop-content').getBoundingClientRect(),b=getComputedStyle(e,'::before'),a=getComputedStyle(e,'::after');
   return {axis:m.x+m.width/2,line:r.x+parseFloat(b.left)+1,w:m.width,h:m.height,left:c.x,right:m.right,before:b.display,after:a.display,top:r.top,bottom:r.bottom};
  }));
  assert.ok(rows.length>3);for(let i=0;i<rows.length;i++){const r=rows[i];assert.ok(Math.abs(r.axis-r.line)<.1,'result dot must be centered on line');assert.equal(r.axis,rows[0].axis);assert.equal(r.w,16);assert.equal(r.h,16);assert.ok(r.left>r.right);if(i>0){assert.equal(r.before,'block');assert.ok(Math.abs(rows[i-1].bottom-r.top)<.1,'continuous line');}}
  assert.equal(rows[0].before,'none');assert.equal(rows.at(-1).after,'none');
 }
 await resultTimeline.screenshot({path:`test-results/result-timeline-${width}-${theme}.png`});
 assert.deepEqual(errors,[]);console.log(`PASS ${width} x ${height} ${theme}: alignment, timeline, keyboard, dialogs, drawer, overflow`);await context.close();
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
