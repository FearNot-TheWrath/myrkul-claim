/**
 * Myrkul's Claim - Complete Soul Tracker Module for Foundry VTT
 * Fixed version with inline templates (no external template files needed)
 */

// V13 Compatibility Layer
class V13Compatibility {
  static get isV13Plus() {
    return foundry.utils.isNewerVersion(game.version, "12.999");
  }

  static async updateActor(actor, data, options = {}) {
    const updateOptions = { diff: false, recursive: false, ...options };
    return await actor.update(data, updateOptions);
  }

  static async createActiveEffects(actor, effectsData, options = {}) {
    const createOptions = { keepId: true, renderSheet: false, temporary: false, ...options };
    return await actor.createEmbeddedDocuments('ActiveEffect', effectsData, createOptions);
  }

  static async deleteActiveEffects(actor, effectIds, options = {}) {
    const deleteOptions = { deleteAll: false, renderSheet: false, ...options };
    return await actor.deleteEmbeddedDocuments('ActiveEffect', effectIds, deleteOptions);
  }

  static async createChatMessage(messageData, options = {}) {
    if (!messageData.type) messageData.type = CONST.CHAT_MESSAGE_TYPES.OTHER;
    return await ChatMessage.create(messageData, options);
  }

  static registerHook(hookName, callback) {
    Hooks.on(hookName, (...args) => {
      try {
        return callback(...args);
      } catch (error) {
        console.error(`Myrkul's Claim | Error in ${hookName} hook:`, error);
        return true;
      }
    });
  }

  static async safeAsync(operation, fallback = null) {
    try {
      return await operation();
    } catch (error) {
      console.error("Myrkul's Claim | Async operation failed:", error);
      return fallback;
    }
  }

  static initialize() {
    console.log("Myrkul's Claim | V13 Compatibility Layer initialized");
  }
}

// Boon Manager
class BoonManager {
  static BOON_TYPES = {
    DARK_BOON: 'darkBoon',
    WHISPERS: 'whispers',
    FOCUS: 'focus'
  };

  static initialize() {
    console.log("Myrkul's Claim | Boon Manager initialized");
  }

  static async spendSoul(boonType, actorId = null) {
    let pactActor = actorId ? game.actors.get(actorId) : MyrkulClaim.getPactActor();
    
    if (!pactActor) {
      ui.notifications.warn("No pact actor configured");
      return false;
    }

    if (!game.user.isGM && !this.canPlayerModify(pactActor)) {
      ui.notifications.error("No permission to spend souls");
      return false;
    }

    const data = MyrkulClaim.getActorSoulData(pactActor);
    if (!data.enabled) {
      ui.notifications.warn("Pact is not enabled for this actor");
      return false;
    }

    if (data.souls < 1) {
      ui.notifications.warn("No soul fragments available");
      return false;
    }

    // Spend the soul
    await MyrkulClaim.updateActorFlags(pactActor, {
      [MyrkulClaim.FLAGS.SOULS]: data.souls - 1,
      [`${MyrkulClaim.FLAGS.BOON_LAST_USED}.${boonType}`]: new Date().toISOString()
    });

    // Apply the boon effect
    await this.applyBoonEffect(pactActor, boonType);

    // Log the activity
    await MyrkulClaim.logActivity(pactActor, 'spend', {
      boonType: boonType,
      soulsAfter: data.souls - 1
    });

    // Refresh UI
    if (window.MyrkulPactWidget) {
      window.MyrkulPactWidget.render();
    }

    ui.notifications.info(`${this.getBoonName(boonType)} activated!`);
    return false;
  }

  static async applyBoonEffect(actor, boonType) {
    switch (boonType) {
      case this.BOON_TYPES.DARK_BOON:
        await this.applyDarkBoon(actor);
        break;
      case this.BOON_TYPES.WHISPERS:
        await this.applyWhispersOfDeath(actor);
        break;
      case this.BOON_TYPES.FOCUS:
        await this.applyReapersFocus(actor);
        break;
      default:
        ui.notifications.error("Invalid boon type");
    }
  }

  static async applyDarkBoon(actor) {
    const paladinLevel = this.getPaladinLevel(actor);
    const tempHP = paladinLevel || 1;

    const currentTemp = actor.system.attributes?.hp?.temp || 0;
    const newTemp = Math.max(currentTemp, tempHP);
    
    await V13Compatibility.updateActor(actor, {
      'system.attributes.hp.temp': newTemp
    });

    const content = `<div class="myrkul-effect-card">
      <strong>${actor.name}</strong> draws upon dark power, gaining <strong>${tempHP} temporary hit points</strong>!
    </div>`;

    await V13Compatibility.createChatMessage({
      content: content,
      speaker: ChatMessage.getSpeaker({ actor: actor }),
      flavor: "Dark Boon"
    });
  }

  static async applyWhispersOfDeath(actor) {
    const effectData = {
      name: "Whispers of Death",
      img: 'icons/magic/death/skull-horned-goat-pentagram-red.webp',
      origin: actor.uuid,
      duration: { seconds: 60 },
      changes: [{
        key: 'system.bonuses.mwak.damage',
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: '1d4[necrotic]'
      }, {
        key: 'system.bonuses.rwak.damage', 
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: '1d4[necrotic]'
      }],
      flags: {
        [MyrkulClaim.ID]: { boonType: this.BOON_TYPES.WHISPERS }
      }
    };

    await V13Compatibility.createActiveEffects(actor, [effectData]);

    const content = `<div class="myrkul-effect-card">
      <strong>${actor.name}'s</strong> weapon is shrouded in <strong>deathly whispers</strong> (+1d4 necrotic damage to next attack)!
    </div>`;

    await V13Compatibility.createChatMessage({
      content: content,
      speaker: ChatMessage.getSpeaker({ actor: actor }),
      flavor: "Whispers of Death"
    });
  }

  static async applyReapersFocus(actor) {
    const effectData = {
      name: "Reaper's Focus",
      img: 'icons/magic/death/skull-energy-light-purple.webp',
      origin: actor.uuid,
      duration: { seconds: 60 },
      changes: [{
        key: 'flags.midi-qol.advantage.ability.save.wis',
        mode: CONST.ACTIVE_EFFECT_MODES.CUSTOM,
        value: '1'
      }, {
        key: 'flags.midi-qol.advantage.ability.save.cha',
        mode: CONST.ACTIVE_EFFECT_MODES.CUSTOM,
        value: '1'
      }],
      flags: {
        [MyrkulClaim.ID]: { boonType: this.BOON_TYPES.FOCUS }
      }
    };

    await V13Compatibility.createActiveEffects(actor, [effectData]);

    const content = `<div class="myrkul-effect-card">
      <strong>${actor.name}</strong> is shielded by the <strong>Reaper's unwavering focus</strong> (advantage on saves vs fear, charm, necrotic)!
    </div>`;

    await V13Compatibility.createChatMessage({
      content: content,
      speaker: ChatMessage.getSpeaker({ actor: actor }),
      flavor: "Reaper's Focus"
    });
  }

  static getPaladinLevel(actor) {
    if (game.system.id === 'dnd5e' && actor.system.classes?.paladin) {
      return actor.system.classes.paladin.levels;
    }
    return actor.system.details?.level || 1;
  }

  static getBoonName(boonType) {
    const names = {
      [this.BOON_TYPES.DARK_BOON]: "Dark Boon",
      [this.BOON_TYPES.WHISPERS]: "Whispers of Death",
      [this.BOON_TYPES.FOCUS]: "Reaper's Focus"
    };
    return names[boonType] || "Unknown Boon";
  }

  static canPlayerModify(actor) {
    const data = MyrkulClaim.getActorSoulData(actor);
    return data.settings.allowPlayerSpend && actor.isOwner;
  }

  static getActiveBoons(actor) {
    return actor.effects.filter(e => 
      e.flags[MyrkulClaim.ID]?.boonType
    ).map(e => ({
      type: e.flags[MyrkulClaim.ID].boonType,
      name: e.name,
      remaining: e.duration.remaining
    }));
  }
}

// Soul Tracker
class SoulTracker {
  static lastAttackerMap = new Map();

  static initialize() {
    console.log("Myrkul's Claim | Soul Tracker initialized");
  }

  static async addSoul(amount = 1, method = 'manual', actorId = null) {
    let pactActor = actorId ? game.actors.get(actorId) : MyrkulClaim.getPactActor();
    
    if (!pactActor) {
      ui.notifications.warn("No pact actor configured");
      return false;
    }

    if (!game.user.isGM && !this.canPlayerModify(pactActor)) {
      ui.notifications.error("No permission to modify souls");
      return false;
    }

    const data = MyrkulClaim.getActorSoulData(pactActor);
    if (!data.enabled) {
      ui.notifications.warn("Pact is not enabled for this actor");
      return false;
    }

    const cap = MyrkulClaim.calculateSoulCap(pactActor);
    let soulsAdded = 0;
    let overflow = false;
    
    if (data.settings.allowOverCap || data.souls < cap) {
      soulsAdded = Math.min(amount, data.settings.allowOverCap ? amount : cap - data.souls);
    } else {
      overflow = true;
    }
    
    const updates = {
      [MyrkulClaim.FLAGS.SOULS]: data.souls + soulsAdded,
      [MyrkulClaim.FLAGS.CORRUPTION]: data.corruption + amount
    };
    
    await MyrkulClaim.updateActorFlags(pactActor, updates);
    
    await MyrkulClaim.logActivity(pactActor, 'award', {
      method: method,
      amount: amount,
      soulsAdded: soulsAdded,
      overflow: overflow,
      soulsAfter: data.souls + soulsAdded
    });
    
    if (soulsAdded > 0) {
      ui.notifications.info(`${soulsAdded} soul fragment${soulsAdded > 1 ? 's' : ''} claimed!`);
      if (window.MyrkulPactWidget) {
        window.MyrkulPactWidget.render();
      }
    } else if (overflow) {
      ui.notifications.warn("Soul slips away coldly - the vessel is full!");
    }
    
    return false;
  }

  static async setSouls(amount, actorId = null) {
    let pactActor = actorId ? game.actors.get(actorId) : MyrkulClaim.getPactActor();
    
    if (!pactActor) {
      ui.notifications.warn("No pact actor configured");
      return false;
    }

    if (!game.user.isGM) {
      ui.notifications.error("Only GM can set soul count directly");
      return false;
    }
    
    await MyrkulClaim.updateActorFlags(pactActor, {
      [MyrkulClaim.FLAGS.SOULS]: Math.max(0, amount)
    });
    
    await MyrkulClaim.logActivity(pactActor, 'set', {
      amount: amount,
      soulsAfter: amount
    });
    
    if (window.MyrkulPactWidget) {
      window.MyrkulPactWidget.render();
    }
    
    ui.notifications.info(`Soul count set to ${amount}`);
    return false;
  }

  static async clearSouls(actorId = null) {
    let pactActor = actorId ? game.actors.get(actorId) : MyrkulClaim.getPactActor();
    
    if (!pactActor) {
      ui.notifications.warn("No pact actor configured");
      return false;
    }

    if (!game.user.isGM && !this.canPlayerModify(pactActor)) {
      ui.notifications.error("No permission to clear souls");
      return false;
    }
    
    await MyrkulClaim.updateActorFlags(pactActor, {
      [MyrkulClaim.FLAGS.SOULS]: 0
    });
    
    await MyrkulClaim.logActivity(pactActor, 'clear', { soulsAfter: 0 });
    
    if (window.MyrkulPactWidget) {
      window.MyrkulPactWidget.render();
    }
    
    ui.notifications.info("All souls cleared");
    return false;
  }

  static async reportStatus(actorId = null) {
    let pactActor = actorId ? game.actors.get(actorId) : MyrkulClaim.getPactActor();
    
    if (!pactActor) {
      ui.notifications.warn("No pact actor configured");
      return false;
    }
    
    const data = MyrkulClaim.getActorSoulData(pactActor);
    const cap = MyrkulClaim.calculateSoulCap(pactActor);
    
    const content = `<div class="myrkul-status-report">
      <h3>${pactActor.name} - Soul Status</h3>
      <p><strong>Souls:</strong> ${data.souls}/${cap}</p>
      <p><strong>Total Corruption:</strong> ${data.corruption}</p>
      <p><strong>Pact Status:</strong> ${data.enabled ? 'Active' : 'Inactive'}</p>
    </div>`;
    
    await V13Compatibility.createChatMessage({
      content: content,
      whisper: [game.user.id]
    });
    
    return false;
  }

  static canPlayerModify(actor) {
    const data = MyrkulClaim.getActorSoulData(actor);
    return data.settings.allowPlayerSpend && actor.isOwner;
  }
}

// Pact Widget - Simplified without external templates
class PactWidget extends Application {
  static instance = null;

  constructor(options = {}) {
    super(options);
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'myrkul-pact-widget',
      title: "Myrkul's Claim",
      classes: ['myrkul-pact-widget'],
      width: 280,
      height: 'auto',
      minimizable: false,
      resizable: false,
      popOut: false
    });
  }

  static render(force = false) {
    if (!this.shouldShow()) {
      if (this.instance) {
        this.instance.close();
      }
      return;
    }

    if (!this.instance) {
      this.instance = new PactWidget();
    }

    this.instance.render(force);
  }

  static shouldShow() {
    const pactActor = MyrkulClaim.getPactActor();
    if (!pactActor) return false;

    const data = MyrkulClaim.getActorSoulData(pactActor);
    if (!data.enabled) return false;

    return game.user.isGM || pactActor.isOwner;
  }

  // Use inline HTML instead of template
  async _renderInner(data) {
    const pactActor = MyrkulClaim.getPactActor();
    if (!pactActor) {
      return $('<div class="no-pact-actor"><p>No pact actor configured</p></div>');
    }

    const soulData = MyrkulClaim.getActorSoulData(pactActor);
    const cap = MyrkulClaim.calculateSoulCap(pactActor);
    const percentage = Math.min((soulData.souls / Math.max(cap, 1)) * 100, 100);
    const canSpend = soulData.souls > 0;
    const canModify = game.user.isGM || SoulTracker.canPlayerModify(pactActor);

    const html = `
      <div class="widget-content" style="padding: 12px;">
        <div class="widget-soul-display" style="text-align: center; margin-bottom: 12px;">
          <div class="soul-counter" style="font-size: 2.5em; font-weight: bold; color: #8b4c8e; cursor: pointer;">
            ${soulData.souls}<span class="soul-cap" style="font-size: 0.5em; opacity: 0.8;">/${cap}</span>
          </div>
          
          <div class="soul-progress" style="width: 100%; height: 6px; background: rgba(0,0,0,0.4); border-radius: 3px; overflow: hidden; margin: 8px 0;">
            <div class="soul-progress-fill" style="height: 100%; background: linear-gradient(90deg, #8b4c8e, #a66da6); transition: width 0.5s ease; border-radius: 3px; width: ${percentage}%;"></div>
          </div>
          
          ${soulData.corruption > 0 ? `
          <div class="corruption-display" style="font-size: 0.8em; color: #5c1f1f; cursor: pointer;">
            Corruption: ${soulData.corruption}
          </div>
          ` : ''}
        </div>

        ${canSpend ? `
        <div class="boon-buttons" style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin: 12px 0;">
          <button class="spend-boon" data-boon-type="darkBoon" 
                  style="background: linear-gradient(135deg, #3d1a28, #2a1520); border: 1px solid #a66da6; color: #e8d5d5; padding: 8px 4px; border-radius: 4px; font-size: 0.75em; cursor: pointer;"
                  ${!canSpend ? 'disabled' : ''}>
            Dark Boon
          </button>
          
          <button class="spend-boon" data-boon-type="whispers"
                  style="background: linear-gradient(135deg, #3d1a28, #2a1520); border: 1px solid #a66da6; color: #e8d5d5; padding: 8px 4px; border-radius: 4px; font-size: 0.75em; cursor: pointer;"
                  ${!canSpend ? 'disabled' : ''}>
            Whispers
          </button>
          
          <button class="spend-boon" data-boon-type="focus"
                  style="background: linear-gradient(135deg, #3d1a28, #2a1520); border: 1px solid #a66da6; color: #e8d5d5; padding: 8px 4px; border-radius: 4px; font-size: 0.75em; cursor: pointer;"
                  ${!canSpend ? 'disabled' : ''}>
            Focus
          </button>
        </div>
        ` : ''}

        ${canModify && game.user.isGM ? `
        <div class="widget-controls" style="display: flex; gap: 4px; margin-top: 8px; justify-content: center;">
          <button class="add-soul" style="background: rgba(0,0,0,0.3); border: 1px solid #3d1a28; color: #e8d5d5; padding: 4px 8px; border-radius: 3px; font-size: 0.7em; cursor: pointer;">
            +
          </button>
          <button class="clear-souls" style="background: rgba(0,0,0,0.3); border: 1px solid #3d1a28; color: #e8d5d5; padding: 4px 8px; border-radius: 3px; font-size: 0.7em; cursor: pointer;">
            Clear
          </button>
        </div>
        ` : ''}
      </div>
    `;

    return $(html);
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find('.spend-boon').click(this._onSpendBoon.bind(this));
    html.find('.add-soul').click(this._onAddSoul.bind(this));
    html.find('.clear-souls').click(this._onClearSouls.bind(this));
    html.find('.soul-counter').on('contextmenu', this._onSoulCounterContext.bind(this));
  }

  async _onSpendBoon(event) {
    event.preventDefault();
    const boonType = event.currentTarget.dataset.boonType;
    await BoonManager.spendSoul(boonType);
  }

  async _onAddSoul(event) {
    event.preventDefault();
    if (!game.user.isGM) return;
    await SoulTracker.addSoul(1, 'manual');
  }

  async _onClearSouls(event) {
    event.preventDefault();
    const confirmed = await Dialog.confirm({
      title: "Clear Souls",
      content: "Are you sure you want to clear all soul fragments?"
    });
    if (confirmed) {
      await SoulTracker.clearSouls();
    }
  }

  _onSoulCounterContext(event) {
    event.preventDefault();
    
    const contextOptions = [
      {
        name: "Set Soul Count",
        icon: '<i class="fas fa-edit"></i>',
        callback: () => this._showSetSoulsDialog()
      },
      {
        name: "View Activity Log", 
        icon: '<i class="fas fa-list"></i>',
        callback: () => this._showActivityLog()
      }
    ];

    if (game.user.isGM) {
      contextOptions.push({
        name: "Open GM Panel",
        icon: '<i class="fas fa-cogs"></i>',
        callback: () => GMPanel.render(true)
      });
    }

    new ContextMenu($(event.currentTarget), null, contextOptions);
  }

  async _showSetSoulsDialog() {
    const pactActor = MyrkulClaim.getPactActor();
    const data = MyrkulClaim.getActorSoulData(pactActor);
    
    new Dialog({
      title: "Set Soul Count",
      content: `
        <form>
          <div class="form-group">
            <label>Number of souls:</label>
            <input type="number" name="souls" value="${data.souls}" min="0" max="100"/>
          </div>
        </form>
      `,
      buttons: {
        set: {
          label: "Set",
          callback: (html) => {
            const souls = parseInt(html.find('[name="souls"]').val());
            if (!isNaN(souls)) {
              SoulTracker.setSouls(souls);
            }
          }
        },
        cancel: {
          label: "Cancel",
          callback: () => {}
        }
      },
      default: 'set'
    }).render(true);
  }

  _showActivityLog() {
    const pactActor = MyrkulClaim.getPactActor();
    const data = MyrkulClaim.getActorSoulData(pactActor);
    
    const logEntries = data.log.slice(-20).reverse().map(entry => {
      const date = new Date(entry.timestamp).toLocaleString();
      return `<tr>
        <td style="padding: 4px; border: 1px solid #666;">${date}</td>
        <td style="padding: 4px; border: 1px solid #666;">${entry.type}</td>
        <td style="padding: 4px; border: 1px solid #666;">${entry.details?.method || '-'}</td>
        <td style="padding: 4px; border: 1px solid #666;">${entry.soulsBefore || 0} → ${entry.soulsAfter || 0}</td>
      </tr>`;
    }).join('');

    const content = `
      <table style="width: 100%; border-collapse: collapse; background: #1a0f14; color: #e8d5d5;">
        <thead>
          <tr style="background: #3d1a28; color: #a66da6;">
            <th style="padding: 6px; border: 1px solid #666;">Time</th>
            <th style="padding: 6px; border: 1px solid #666;">Type</th>
            <th style="padding: 6px; border: 1px solid #666;">Method</th>
            <th style="padding: 6px; border: 1px solid #666;">Souls</th>
          </tr>
        </thead>
        <tbody>
          ${logEntries || '<tr><td colspan="4" style="text-align: center; padding: 12px;"><em>No activity recorded</em></td></tr>'}
        </tbody>
      </table>
    `;

    new Dialog({
      title: "Soul Activity Log",
      content: content,
      buttons: {
        close: {
          label: "Close",
          callback: () => {}
        }
      }
    }, {
      width: 600,
      height: 400
    }).render(true);
  }

  async close(options = {}) {
    if (PactWidget.instance === this) {
      PactWidget.instance = null;
    }
    return super.close(options);
  }
}

// GM Panel - Simplified without external templates
class GMPanel extends FormApplication {
  static instance = null;

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'myrkul-gm-panel',
      title: "Myrkul's Claim - GM Panel",
      classes: ['myrkul-gm-panel'],
      width: 500,
      height: 'auto',
      closeOnSubmit: false,
      submitOnChange: false,
      resizable: true
    });
  }

  static render(force = false) {
    if (!game.user.isGM) {
      ui.notifications.error("GM Panel is only available to GMs");
      return;
    }

    if (!this.instance) {
      this.instance = new GMPanel();
    }

    this.instance.render(force);
  }

  // Use inline HTML instead of template
  async _renderInner(data) {
    const pactActorId = game.settings.get(MyrkulClaim.ID, MyrkulClaim.SETTINGS.PACT_ACTOR_ID);
    const pactActor = pactActorId ? game.actors.get(pactActorId) : null;
    
    let pactData = null;
    if (pactActor) {
      pactData = MyrkulClaim.getActorSoulData(pactActor);
      pactData.cap = MyrkulClaim.calculateSoulCap(pactActor);
    }

    const playerActors = game.actors.filter(actor => 
      actor.type === 'character' && actor.hasPlayerOwner
    );

    const actorOptions = playerActors.map(actor => 
      `<option value="${actor.id}" ${actor.id === pactActorId ? 'selected' : ''}>${actor.name}</option>`
    ).join('');

    const html = `
      <form style="padding: 12px;">
        <!-- Pact Actor Selection -->
        <div class="form-group" style="margin-bottom: 12px;">
          <label style="display: block; font-weight: bold; margin-bottom: 4px;">Pact Actor</label>
          <select name="pactActorId" style="width: 100%; padding: 4px;">
            <option value="">Select Pact Actor</option>
            ${actorOptions}
          </select>
        </div>

        ${pactActor ? `
        <!-- Pact Status -->
        <div class="pact-status" style="border: 1px solid #666; padding: 12px; margin-bottom: 12px; border-radius: 4px; ${!pactData.enabled ? 'opacity: 0.6;' : ''}">
          <h3 style="margin-top: 0;">${pactActor.name} - Status</h3>
          
          <div class="status-grid" style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 12px; margin: 12px 0; text-align: center;">
            <div class="status-item">
              <div class="status-value" style="font-size: 1.5em; font-weight: bold; color: #8b4c8e;">${pactData.souls}</div>
              <div class="status-label" style="font-size: 0.8em; opacity: 0.8;">Souls</div>
            </div>
            <div class="status-item">
              <div class="status-value" style="font-size: 1.5em; font-weight: bold; color: #8b4c8e;">${pactData.cap}</div>
              <div class="status-label" style="font-size: 0.8em; opacity: 0.8;">Capacity</div>
            </div>
            <div class="status-item">
              <div class="status-value"