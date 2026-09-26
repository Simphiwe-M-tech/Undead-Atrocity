/**
 * StoryUI - professional, reusable narrative presentation for investigation,
 * evidence, objectives and antagonist messages. All DOM is created at runtime
 * so the existing index.html does not need to change.
 */
export class StoryUI {
  constructor(hudRoot) {
    this.hudRoot = hudRoot;
    this.isEvidenceOpen = false;
    this.bannerTimer = 0;
    this.messageTimer = 0;
    this.introTimer = 0;
    this.dialogueTimer = 0;
    this.messageQueue = [];
    this.dialogueQueue = [];
    this._build();
  }

  _build() {
    const make = (tag, id, className = '') => {
      const el = document.createElement(tag);
      if (id) el.id = id;
      if (className) el.className = className;
      return el;
    };

    this.objectivePanel = make('div', 'story-objective', 'story-objective');
    this.objectivePanel.innerHTML = `
      <div class="story-objective-kicker">CURRENT OBJECTIVE</div>
      <div class="story-objective-text">Find out what happened.</div>
      <div class="story-evidence-count">STORY CLUES 0 / 2</div>
    `;
    this.hudRoot.appendChild(this.objectivePanel);
    this.objectiveText = this.objectivePanel.querySelector('.story-objective-text');
    this.evidenceCount = this.objectivePanel.querySelector('.story-evidence-count');

    this.interactPrompt = make('div', 'story-interact', 'story-interact hidden');
    this.interactPrompt.innerHTML = '<span class="keycap">E</span><span>INVESTIGATE</span>';
    this.hudRoot.appendChild(this.interactPrompt);

    this.banner = make('div', 'story-banner', 'story-banner hidden');
    this.banner.innerHTML = '<div class="story-banner-title"></div><div class="story-banner-subtitle"></div>';
    this.hudRoot.appendChild(this.banner);

    this.message = make('div', 'story-message', 'story-message hidden');
    this.message.innerHTML = `
      <div class="story-message-head"><span class="phone-dot"></span><span class="story-message-sender"></span></div>
      <div class="story-message-text"></div>
    `;
    this.hudRoot.appendChild(this.message);

    this.dialogue = make('div', 'story-dialogue', 'story-dialogue hidden');
    this.dialogue.innerHTML = `<span class="story-dialogue-speaker"></span><span class="story-dialogue-text"></span>`;
    this.hudRoot.appendChild(this.dialogue);

    this.evidenceOverlay = make('div', 'evidence-overlay', 'evidence-overlay hidden');
    this.evidenceOverlay.innerHTML = `
      <div class="evidence-backdrop"></div>
      <article class="evidence-card">
        <div class="evidence-topline"><span class="evidence-eyebrow"></span><span class="evidence-status">RECOVERED</span></div>
        <h2 class="evidence-title"></h2>
        <div class="evidence-rule"></div>
        <div class="evidence-body"></div>
        <div class="evidence-insight"><span>INVESTIGATION NOTE</span><p></p></div>
        <div class="evidence-close"><span class="keycap">E</span> / ESC &mdash; CLOSE &middot; RELEASE, THEN PRESS</div>
      </article>
    `;
    document.body.appendChild(this.evidenceOverlay);

    this.intro = make('div', 'story-intro', 'story-intro hidden');
    this.intro.innerHTML = `
      <div class="story-intro-vignette"></div>
      <div class="story-intro-copy">
        <div class="story-intro-title"></div>
        <div class="story-intro-subtitle"></div>
      </div>
    `;
    document.body.appendChild(this.intro);
  }

  reset(objective = 'Find your phone.', totalClues = 2) {
    this.messageQueue.length = 0;
    this.dialogueQueue.length = 0;
    this.isEvidenceOpen = false;
    this.bannerTimer = 0;
    this.messageTimer = 0;
    this.introTimer = 0;
    this.dialogueTimer = 0;
    this.hideInteraction();
    this.banner.classList.add('hidden');
    this.message.classList.add('hidden');
    this.dialogue.classList.add('hidden');
    this.evidenceOverlay.classList.add('hidden');
    this.intro.classList.add('hidden');
    this.setObjective(objective);
    this.setEvidence(0, totalClues);
  }

  setObjective(text) {
    if (!text) return;
    this.objectiveText.textContent = text;
    this.objectivePanel.classList.remove('objective-pulse');
    void this.objectivePanel.offsetWidth;
    this.objectivePanel.classList.add('objective-pulse');
  }

  setEvidence(found, total) {
    this.evidenceCount.textContent = `STORY CLUES ${found} / ${total}`;
  }

  showInteraction(label = 'E  INVESTIGATE') {
    if (this.interactionLabel === label) return;
    this.interactionLabel = label;
    const clean = label.replace(/^E\s*/i, '').trim() || 'INVESTIGATE';
    this.interactPrompt.innerHTML = `<span class="keycap">E</span><span>${clean}</span>`;
    this.interactPrompt.classList.remove('hidden');
  }

  hideInteraction() {
    this.interactionLabel = null;
    this.interactPrompt.classList.add('hidden');
  }

  showEvidence(evidence) {
    if (this.isEvidenceOpen) return;
    this.isEvidenceOpen = true;
    this.hideInteraction();
    this.evidenceOverlay.querySelector('.evidence-eyebrow').textContent = evidence.eyebrow || 'EVIDENCE';
    this.evidenceOverlay.querySelector('.evidence-title').textContent = evidence.title || 'EVIDENCE FOUND';
    const body = this.evidenceOverlay.querySelector('.evidence-body');
    body.innerHTML = '';
    for (const line of evidence.body || []) {
      const p = document.createElement('p');
      p.textContent = line;
      body.appendChild(p);
    }
    this.evidenceOverlay.querySelector('.evidence-insight p').textContent = evidence.insight || '';
    this.evidenceOverlay.classList.remove('hidden');
    this.evidenceOverlay.classList.remove('evidence-in');
    void this.evidenceOverlay.offsetWidth;
    this.evidenceOverlay.classList.add('evidence-in');
  }

  closeEvidence() {
    this.isEvidenceOpen = false;
    this.evidenceOverlay.classList.add('hidden');
  }

  _readingDuration(text, minimum, secondsPerWord, maximum) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
    return Math.min(maximum, Math.max(minimum, minimum + words * secondsPerWord));
  }

  showMessage(sender, text, duration = null) {
    if (this.messageTimer > 0) { this.messageQueue.push([sender, text, duration]); return; }
    this.message.querySelector('.story-message-sender').textContent = sender || 'UNKNOWN';
    this.message.querySelector('.story-message-text').textContent = text || '';
    this.message.classList.remove('hidden');
    this.message.classList.remove('message-in');
    void this.message.offsetWidth;
    this.message.classList.add('message-in');
    this.messageTimer = duration ?? this._readingDuration(text, 5.2, 0.18, 8.5);
  }

  showDialogue(speaker, text, duration = null) {
    if (this.dialogueTimer > 0) { this.dialogueQueue.push([speaker, text, duration]); return; }
    this.dialogue.querySelector('.story-dialogue-speaker').textContent = `${speaker || 'YOU'}:`;
    this.dialogue.querySelector('.story-dialogue-text').textContent = text || '';
    this.dialogue.classList.remove('hidden');
    this.dialogue.classList.remove('dialogue-in');
    void this.dialogue.offsetWidth;
    this.dialogue.classList.add('dialogue-in');
    this.dialogueTimer = duration ?? this._readingDuration(text, 4.6, 0.17, 7.5);
  }

  showBanner(title, subtitle = '', duration = null) {
    this.banner.querySelector('.story-banner-title').textContent = title || '';
    this.banner.querySelector('.story-banner-subtitle').textContent = subtitle || '';
    this.banner.classList.remove('hidden');
    this.banner.classList.remove('banner-in');
    void this.banner.offsetWidth;
    this.banner.classList.add('banner-in');
    const bannerText = `${title || ''} ${subtitle || ''}`;
    this.bannerTimer = duration ?? this._readingDuration(bannerText, 3.6, 0.11, 6.0);
  }

  showIntro(title, subtitle = '', duration = null) {
    this.intro.querySelector('.story-intro-title').textContent = title || '';
    this.intro.querySelector('.story-intro-subtitle').textContent = subtitle || '';
    this.intro.classList.remove('hidden');
    this.intro.classList.remove('intro-play');
    void this.intro.offsetWidth;
    this.intro.classList.add('intro-play');
    const introText = `${title || ''} ${subtitle || ''}`;
    this.introTimer = duration ?? this._readingDuration(introText, 4.6, 0.14, 7.0);
  }

  update(dt) {
    if (this.isEvidenceOpen) return;
    if (this.messageTimer <= 0 && this.messageQueue.length) this.showMessage(...this.messageQueue.shift());
    if (this.dialogueTimer <= 0 && this.dialogueQueue.length) this.showDialogue(...this.dialogueQueue.shift());
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.add('hidden');
    }
    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.message.classList.add('hidden');
    }
    if (this.dialogueTimer > 0) {
      this.dialogueTimer -= dt;
      if (this.dialogueTimer <= 0) this.dialogue.classList.add('hidden');
    }
    if (this.introTimer > 0) {
      this.introTimer -= dt;
      if (this.introTimer <= 0) this.intro.classList.add('hidden');
    }
  }
}
