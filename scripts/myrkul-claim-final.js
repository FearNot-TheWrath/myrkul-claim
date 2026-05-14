/**
 * Myrkul's Claim - Manual Soul Tracker Module for Foundry VTT
 * - Manual-only (no automation, no AEs, no sheet edits from boons)
 * - Corruption increases ONLY when spending a soul
 * - !soul reset (souls + corruption -> 0), !soul dec [n] to reduce corruption
 * - Pact Panel (GM or pact owner) with corruption milestone descriptions
 * - Small HUD widget & sheet widget for quick access
 */

console.log("Myrkul's Claim | Loading module...");

/* -----------------------------
 * V13 Compatibility Layer
 * ----------------------------- */
class V13Compatibility {
  static get isV13Plus() {
    return foundry.utils.isNewerVersion(game.version || "11.0", "12.999");
  }
  static async updateActor(actor, data, options = {}) {
    // Safer defaults: merge diffs instead of replacing
    const updateOptions = { diff: true, recursive: true, ...options };
    return await actor.update(data, updateOptions);
  }
  static async createChatMessage(messageData, options = {}) {
    const STYLES = CONST.CHAT_MESSAGE_STYLES ?? CONST.CHAT_MESSAGE_TYPES;
    if (messageData.style === undefined && messageData.type === undefined) {
      if (CONST.CHAT_MESSAGE_STYLES) messageData.style = STYLES.OTHER;
      else messageData.type = STYLES.OTHER;
    }
    return await ChatMessage.create(messageData, options);
  }
  static registerHook(hookName, callback) {
    Hooks.on(hookName, (...args) => {
      try { return callback(...args); }
      catch (error) {
        console.error(`Myrkul's Claim | Error in ${hookName} hook:`, error);
        return true;
      }
    });
  }
  static async safeAsync(operation, fallback = null) {
    try { return await operation(); }
    catch (error) { console.error("Myrkul's Claim | Async op failed:", error); return fallback; }
  }
  static initialize() {
    console.log("Myrkul's Claim | V13 Compatibility Layer initialized");
  }
}

/* -----------------------------
 * Boon Manager (CHAT-ONLY)
 * ----------------------------- */
class BoonManager {
  static BOON_TYPES = { DARK_BOON: "darkBoon", WHISPERS: "whispers", FOCUS: "focus" };
  static initialize() { console.log("Myrkul's Claim | Boon Manager initialized"); }
  static canPlayerModify(actor) { return game.user.isGM || actor?.isOwner; }

  static async spendSoul(boonType, actorId = null) {
    const pactActor = actorId ? game.actors.get(actorId) : MyrkulClaim.getPactActor();
    if (!pactActor) { ui.notifications.warn("No pact actor configured"); return false; }
    if (!this.canPlayerModify(pactActor)) { ui.notifications.error("No permission to spend souls"); return false; }

    const data = MyrkulClaim.getActorSoulData(pactActor);
    if (!data.enabled) { ui.notifications.warn("Pact is not enabled for this actor"); return false; }
    if (data.souls < 1) { ui.notifications.warn("No soul fragments available"); return false; }

    // Spend 1 soul and add 1 corruption
    await MyrkulClaim.updateActorFlags(pactActor, {
      [MyrkulClaim.FLAGS.SOULS]: data.souls - 1,
      [MyrkulClaim.FLAGS.CORRUPTION]: data.corruption + 1
    });

    // Chat-only boon guidance (no AEs, no sheet writes)
    await this.applyBoonEffect(pactActor, boonType);

    await MyrkulClaim.logActivity(pactActor, "spend", {
      boonType, soulsAfter: data.souls - 1, corruptionAfter: data.corruption + 1
    });

    if (window.MyrkulPactWidget) window.MyrkulPactWidget.render();
    ui.notifications.info(`${this.getBoonName(boonType)} activated!`);
    return false;
  }

  static async applyBoonEffect(actor, boonType) {
    switch (boonType) {
      case this.BOON_TYPES.DARK_BOON: return this.applyDarkBoon(actor);
      case this.BOON_TYPES.WHISPERS:  return this.applyWhispersOfDeath(actor);
      case this.BOON_TYPES.FOCUS:     return this.applyReapersFocus(actor);
      default: ui.notifications.error("Invalid boon type");
    }
  }

  static async applyDarkBoon(actor) {
    const paladinLevel = this.getPaladinLevel(actor);
    const tempHP = paladinLevel || 1;
    const content = `
      <div style="padding:8px;">
        <strong>${actor.name}</strong> invokes the <strong>Dark Boon</strong>.<br>
        <em>Gain temporary hit points equal to Paladin level:</em> <strong>${tempHP}</strong>.<br>
        <small>(Manual: add temp HP to your sheet.)</small>
      </div>`;
    await V13Compatibility.createChatMessage({
      content, speaker: ChatMessage.getSpeaker({ actor }), flavor: "Dark Boon"
    });
  }

  static async applyWhispersOfDeath(actor) {
    const content = `
      <div style="padding:8px;">
        <strong>${actor.name}</strong> is wreathed in <strong>Whispers of Death</strong>.<br>
        <em>Add</em> <strong>+1d4 necrotic</strong> to one attack this turn.<br>
        <small>(Manual: add the extra damage die when you roll.)</small>
      </div>`;
    await V13Compatibility.createChatMessage({
      content, speaker: ChatMessage.getSpeaker({ actor }), flavor: "Whispers of Death"
    });
  }

  static async applyReapersFocus(actor) {
    const content = `
      <div style="padding:8px;">
        <strong>${actor.name}</strong> steels themselves with <strong>Reaper’s Focus</strong>.<br>
        <em>Gain advantage on one saving throw</em> vs fear, charm, or necrotic.<br>
        <small>(Manual: roll with advantage when it applies.)</small>
      </div>`;
    await V13Compatibility.createChatMessage({
      content, speaker: ChatMessage.getSpeaker({ actor }), flavor: "Reaper's Focus"
    });
  }

  static getPaladinLevel(actor) {
    if (game.system.id === "dnd5e" && actor.system.classes?.paladin) return actor.system.classes.paladin.levels;
    return actor.system.details?.level || 1;
  }
  static getBoonName(boonType) {
    const names = { darkBoon: "Dark Boon", whispers: "Whispers of Death", focus: "Reaper's Focus" };
    return names[boonType] || "Unknown Boon";
  }
}

/* -----------------------------
 * Soul Tracker
 * ----------------------------- */
class SoulTracker {
  static initialize() { console.log("Myrkul's Claim | Soul Tracker initialized"); }
  static canPlayerModify(actor) { return game.user.isGM || actor?.isOwner; }

  static async addSoul(amount = 1, method = "manual", actorId = null) {
    const pactActor = actorId ? game.actors.get(actorId) : MyrkulClaim.getPactActor();
    if (!pactActor) { ui.notifications.warn("No pact actor configured"); return false; }
    if (!this.canPlayerModify(pactActor)) { ui.notifications.error("No permission to modify souls"); return false; }

    const data = MyrkulClaim.getActorSoulData(pactActor);
    if (!data.enabled) { ui.notifications.warn("Pact is not enabled for this actor"); return false; }

    const cap = MyrkulClaim.calculateSoulCap(pactActor);
    const canAdd = Math.max(0, cap - data.souls);
    const soulsAdded = Math.min(amount, canAdd);

    await MyrkulClaim.updateActorFlags(pactActor, { [MyrkulClaim.FLAGS.SOULS]: data.souls + soulsAdded });
    await MyrkulClaim.logActivity(pactActor, "award", { method, amount, soulsAdded, soulsAfter: data.souls + soulsAdded });

    if (soulsAdded > 0) ui.notifications.info(`${soulsAdded} soul fragment${soulsAdded > 1 ? "s" : ""} claimed.`);
    else ui.notifications.warn("Soul slips away coldly. The vessel is full.");

    if (window.MyrkulPactWidget) window.MyrkulPactWidget.render();
    return false;
  }

  static async clearSouls(actorId = null) {
    const pactActor = actorId ? game.actors.get(actorId) : MyrkulClaim.getPactActor();
    if (!pactActor) { ui.notifications.warn("No pact actor configured"); return false; }
    if (!this.canPlayerModify(pactActor)) { ui.notifications.error("No permission to clear souls"); return false; }

    await MyrkulClaim.updateActorFlags(pactActor, { [MyrkulClaim.FLAGS.SOULS]: 0 });
    await MyrkulClaim.logActivity(pactActor, "clear", { soulsAfter: 0 });
    if (window.MyrkulPactWidget) window.MyrkulPactWidget.render();
    ui.notifications.info("All souls cleared.");
    return false;
  }

  static async resetCorruption(actorId = null) {
    const pactActor = actorId ? game.actors.get(actorId) : MyrkulClaim.getPactActor();
    if (!pactActor) { ui.notifications.warn("No pact actor configured"); return false; }
    if (!this.canPlayerModify(pactActor)) { ui.notifications.error("No permission to reset corruption"); return false; }

    await MyrkulClaim.updateActorFlags(pactActor, { [MyrkulClaim.FLAGS.CORRUPTION]: 0 });
    await MyrkulClaim.logActivity(pactActor, "resetCorruption", { corruption: 0 });
    if (window.MyrkulPactWidget) window.MyrkulPactWidget.render();
    ui.notifications.info("Corruption reset to 0.");
    return false;
  }

  static async decreaseCorruption(amount = 1, actorId = null) {
    const pactActor = actorId ? game.actors.get(actorId) : MyrkulClaim.getPactActor();
    if (!pactActor) { ui.notifications.warn("No pact actor configured"); return false; }
    if (!this.canPlayerModify(pactActor)) { ui.notifications.error("No permission to decrease corruption"); return false; }

    const data = MyrkulClaim.getActorSoulData(pactActor);
    const newValue = Math.max(0, data.corruption - amount);

    await MyrkulClaim.updateActorFlags(pactActor, { [MyrkulClaim.FLAGS.CORRUPTION]: newValue });
    await MyrkulClaim.logActivity(pactActor, "decreaseCorruption", { amount, corruption: newValue });
    if (window.MyrkulPactWidget) window.MyrkulPactWidget.render();
    ui.notifications.info(`Corruption decreased by ${amount}.`);
    return false;
  }
}

/* -----------------------------
 * Pact Widget (small HUD)
 * ----------------------------- */
class PactWidget extends Application {
  static instance = null;
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "myrkul-pact-widget", title: "Myrkul's Claim",
      classes: ["myrkul-pact-widget"], width: 280, height: "auto",
      minimizable: false, resizable: false, popOut: false
    });
  }
  static render(force = false) {
    if (!this.shouldShow()) { if (this.instance) this.instance.close(); return; }
    if (!this.instance) this.instance = new PactWidget();
    this.instance.render(force);
  }
  static shouldShow() {
    const pactActor = MyrkulClaim.getPactActor(); if (!pactActor) return false;
    const data = MyrkulClaim.getActorSoulData(pactActor); if (!data.enabled) return false;
    return game.user.isGM || pactActor.isOwner;
  }
  async _renderInner() {
    const pactActor = MyrkulClaim.getPactActor();
    if (!pactActor) return $('<div><p>No pact actor configured</p></div>');
    const soulData = MyrkulClaim.getActorSoulData(pactActor);
    const cap = MyrkulClaim.calculateSoulCap(pactActor);
    const percentage = Math.min((soulData.souls / Math.max(cap, 1)) * 100, 100);

    const html = `
      <div style="padding:12px;background:linear-gradient(135deg,#1a0f14,#2a1520);color:#e8d5d5;">
        <div style="text-align:center;margin-bottom:12px;">
          <div style="font-size:2.2em;font-weight:bold;color:#8b4c8e;">
            ${soulData.souls}<span style="font-size:0.5em;opacity:0.8;">/${cap}</span>
          </div>
          <div style="width:100%;height:6px;background:rgba(0,0,0,.4);border-radius:3px;overflow:hidden;margin:8px 0;">
            <div style="height:100%;background:linear-gradient(90deg,#8b4c8e,#a66da6);width:${percentage}%;"></div>
          </div>
          ${soulData.corruption>0?`<div style="font-size:.8em;color:#a66da6;">Corruption: ${soulData.corruption}</div>`:""}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">
          <button class="spend-boon" data-boon-type="darkBoon">Dark Boon</button>
          <button class="spend-boon" data-boon-type="whispers">Whispers</button>
          <button class="spend-boon" data-boon-type="focus">Focus</button>
        </div>
        ${(game.user.isGM || pactActor.isOwner)?`
        <div style="display:flex;gap:4px;margin-top:8px;justify-content:center;">
          <button class="add-soul">+1</button>
          <button class="clear-souls">Clear</button>
        </div>`:""}
      </div>`;
    return $(html);
  }
  activateListeners(html) {
    super.activateListeners(html);
    html.find(".spend-boon").click(async e => { await BoonManager.spendSoul(e.currentTarget.dataset.boonType); });
    html.find(".add-soul").click(async () => { await SoulTracker.addSoul(1, "manual"); });
    html.find(".clear-souls").click(async () => {
      const ok = await Dialog.confirm({ title:"Clear Souls", content:"Clear all soul fragments?" });
      if (ok) await SoulTracker.clearSouls();
    });
  }
}

/* -----------------------------
 * Pact Panel (GM or pact owner)
 * ----------------------------- */
class GMPanel extends FormApplication {
  static instance = null;
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "myrkul-gm-panel", title: "Myrkul's Claim – Pact Panel",
      classes: ["myrkul-gm-panel"], width: 520, height: "auto",
      closeOnSubmit: false, submitOnChange: false, resizable: true
    });
  }
  static render(force=false){
    if(!MyrkulClaim.userCanOpenPanel()){
      ui.notifications.error("Only the pact actor's owner or a GM can open this panel"); return;
    }
    if(!this.instance) this.instance = new GMPanel(); this.instance.render(force);
  }

  async _renderInner() {
    const pactActorId = game.settings.get(MyrkulClaim.ID, MyrkulClaim.SETTINGS.PACT_ACTOR_ID);
    const pactActor = pactActorId ? game.actors.get(pactActorId) : null;
    const playerActors = game.actors.filter(a => a.type==="character" && a.hasPlayerOwner);
    const actorOptions = playerActors.map(a => `<option value="${a.id}" ${a.id===pactActorId?"selected":""}>${a.name}</option>`).join("");

    let pactData = null, cap = 0;
    if (pactActor) { pactData = MyrkulClaim.getActorSoulData(pactActor); cap = MyrkulClaim.calculateSoulCap(pactActor); }
    const isGM = game.user.isGM, isOwner = pactActor ? pactActor.isOwner : false;

    // Corruption milestones revealed only when reached
    const milestonesHtml = pactData ? MyrkulClaim.CORRUPTION_THRESHOLDS
      .filter(t => pactData.corruption >= t.value)
      .map(t => `<div style="margin-top:6px;padding:6px;border-left:3px solid #a66da6;background:rgba(166,109,166,0.08);font-size:.9em;">${t.description}</div>`)
      .join("") : "";

    // Boon reference text
    const boonRef = `
      <div style="margin-top:10px;padding:8px;border:1px dashed #3d1a28;border-radius:4px;">
        <div style="font-weight:bold;color:#a66da6;">Boon Reference</div>
        <div><strong>Dark Boon:</strong> Temp HP = Paladin level.</div>
        <div><strong>Whispers of Death:</strong> +1d4 necrotic to one attack.</div>
        <div><strong>Reaper's Focus:</strong> Advantage on one save vs fear, charm, or necrotic.</div>
      </div>`;

    const html = `
      <form style="padding:12px;background:linear-gradient(135deg,#1a0f14,#2a1520);color:#e8d5d5;">
        <div style="margin-bottom:12px;">
          <label style="display:block;font-weight:bold;margin-bottom:4px;color:#a66da6;">Pact Actor</label>
          <select name="pactActorId" style="width:100%;padding:4px;background:rgba(0,0,0,.3);border:1px solid #3d1a28;color:#e8d5d5;">
            <option value="">Select Pact Actor</option>
            ${actorOptions}
          </select>
        </div>

        ${pactActor ? `
        <div style="border:1px solid #3d1a28;padding:12px;margin-bottom:12px;border-radius:4px;${!pactData.enabled?"opacity:.6;":""}">
          <h3 style="margin:0;color:#a66da6;">${pactActor.name} — Status</h3>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:12px 0;text-align:center;">
            <div><div style="font-size:1.4em;font-weight:bold;color:#8b4c8e;">${pactData.souls}</div><div style="font-size:.8em;opacity:.8;">Souls</div></div>
            <div><div style="font-size:1.4em;font-weight:bold;color:#8b4c8e;">${cap}</div><div style="font-size:.8em;opacity:.8;">Capacity</div></div>
            <div><div style="font-size:1.4em;font-weight:bold;color:#a66da6;">${pactData.corruption}</div><div style="font-size:.8em;opacity:.8;">Corruption</div></div>
            <div><div style="font-size:1.4em;font-weight:bold;">${pactData.enabled?"✓":"✗"}</div><div style="font-size:.8em;opacity:.8;">Status</div></div>
          </div>

          ${milestonesHtml ? `<div style="margin-top:6px;">${milestonesHtml}</div>` : ""}

          <button type="button" class="toggle-enabled" style="padding:8px 16px;margin:8px 0;background:${pactData.enabled?"#2d5a3d":"#666"};border:1px solid #3d1a28;color:#e8d5d5;border-radius:4px;cursor:pointer;">
            ${pactData.enabled ? "Disable Pact" : "Enable Pact"}
          </button>
        </div>

        <div style="margin-bottom:12px;">
          <h4 style="color:#a66da6;">Soul Management</h4>
          ${(isGM||isOwner)?`
          <div style="display:flex;align-items:center;gap:8px;margin:8px 0;padding:8px;background:rgba(0,0,0,.2);border-radius:4px;">
            <label>Add Souls:</label>
            <input type="number" name="addAmount" value="1" min="1" max="10" style="width:64px;background:rgba(0,0,0,.3);border:1px solid #3d1a28;color:#e8d5d5;padding:4px;">
            <button type="button" class="add-soul" style="padding:4px 8px;background:linear-gradient(135deg,#3d1a28,#2a1520);border:1px solid #a66da6;color:#e8d5d5;border-radius:3px;cursor:pointer;">Add</button>
            <button type="button" class="clear-souls" style="padding:4px 8px;background:linear-gradient(135deg,#5c1f1f,#3d1515);border:1px solid #cc3333;color:#e8d5d5;border-radius:3px;cursor:pointer;">Clear All</button>
          </div>`:""}
        </div>

        <div style="margin-bottom:12px;">
          <h4 style="color:#a66da6;">Corruption Controls</h4>
          <div style="display:flex;align-items:center;gap:8px;margin:8px 0;padding:8px;background:rgba(0,0,0,.2);border-radius:4px;">
            <label>Decrease:</label>
            <input type="number" name="decAmount" value="1" min="1" max="50" style="width:64px;background:rgba(0,0,0,.3);border:1px solid #3d1a28;color:#e8d5d5;padding:4px;">
            <button type="button" class="dec-corruption" style="padding:4px 8px;background:linear-gradient(135deg,#3d1a28,#2a1520);border:1px solid #a66da6;color:#e8d5d5;border-radius:3px;cursor:pointer;">Apply</button>
            <button type="button" class="reset-corruption" style="padding:4px 8px;background:linear-gradient(135deg,#3d1a28,#2a1520);border:1px solid #a66da6;color:#e8d5d5;border-radius:3px;cursor:pointer;">Reset to 0</button>
          </div>
        </div>

        <div style="margin-bottom:12px;">
          <h4 style="color:#a66da6;">Spend Boons</h4>
          <div style="display:flex;gap:8px;margin:8px 0;padding:8px;background:rgba(0,0,0,.2);border-radius:4px;">
            <button type="button" class="force-spend" data-boon-type="darkBoon" style="padding:4px 8px;background:linear-gradient(135deg,#3d1a28,#2a1520);border:1px solid #a66da6;color:#e8d5d5;border-radius:3px;cursor:pointer;font-size:.9em;">Dark Boon</button>
            <button type="button" class="force-spend" data-boon-type="whispers"  style="padding:4px 8px;background:linear-gradient(135deg,#3d1a28,#2a1520);border:1px solid #a66da6;color:#e8d5d5;border-radius:3px;cursor:pointer;font-size:.9em;">Whispers</button>
            <button type="button" class="force-spend" data-boon-type="focus"     style="padding:4px 8px;background:linear-gradient(135deg,#3d1a28,#2a1520);border:1px solid #a66da6;color:#e8d5d5;border-radius:3px;cursor:pointer;font-size:.9em;">Focus</button>
          </div>
          ${boonRef}
        </div>
        ` : ""}

      </form>
    `;
    return $(html);
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find('select[name="pactActorId"]').change(async (event) => {
      const actorId = event.target.value || null;
      await game.settings.set(MyrkulClaim.ID, MyrkulClaim.SETTINGS.PACT_ACTOR_ID, actorId);
      PactWidget.render();
      this.render();
      ui.notifications.info("Pact actor updated");
    });

    html.find(".add-soul").click(async (e) => {
      const amount = parseInt($(e.currentTarget).closest("div").find('input[name="addAmount"]').val()) || 1;
      await SoulTracker.addSoul(amount, "manual");
      this.render();
    });

    html.find(".clear-souls").click(async () => {
      const confirmed = await Dialog.confirm({ title: "Clear Souls", content: "Clear all soul fragments?" });
      if (confirmed) { await SoulTracker.clearSouls(); this.render(); }
    });

    html.find(".toggle-enabled").click(async () => {
      const pactActor = MyrkulClaim.getPactActor(); if (!pactActor) return;
      const data = MyrkulClaim.getActorSoulData(pactActor);
      const newEnabled = !data.enabled;
      await MyrkulClaim.updateActorFlags(pactActor, { [MyrkulClaim.FLAGS.ENABLED]: newEnabled });
      PactWidget.render(); this.render();
      ui.notifications.info(newEnabled ? "Pact enabled" : "Pact disabled");
    });

    html.find(".dec-corruption").click(async (e) => {
      const amount = parseInt($(e.currentTarget).closest("div").find('input[name="decAmount"]').val()) || 1;
      await SoulTracker.decreaseCorruption(amount);
      this.render();
    });

    html.find(".reset-corruption").click(async () => {
      await SoulTracker.resetCorruption();
      this.render();
    });

    html.find(".force-spend").click(async (e) => {
      const boonType = e.currentTarget.dataset.boonType;
      await BoonManager.spendSoul(boonType);
      this.render();
    });
  }
}

/* -----------------------------
 * Main Module Class
 * ----------------------------- */
class MyrkulClaim {
  static ID = "myrkul-claim";
  static FLAGS = {
    ENABLED: "enabled",
    SOULS: "souls",
    CAP_MODE: "capMode",
    CAP_VALUE: "capValue",
    CORRUPTION: "corruption",
    SETTINGS: "settings",
    LOG: "log"
  };
  static SETTINGS = { PACT_ACTOR_ID: "pactActorId" };

  // Corruption milestones (revealed once reached)
  static CORRUPTION_THRESHOLDS = [
    { value: 10, description: "Your eyes flash pale with Myrkul’s fire." },
    { value: 25, description: "Myrkul whispers more frequently, pushing his agenda." },
    { value: 50, description: "You risk becoming Myrkul’s Exarch unless something intervenes." }
  ];

  static initialize() {
    console.log(`${this.ID} | Initializing Myrkul's Claim`);
    V13Compatibility.initialize();
    this.registerSettings();
    BoonManager.initialize();
    SoulTracker.initialize();

    this.registerHooks();
    this.registerChatCommands();
    this.setupAPI();
  }

  static registerSettings() {
    game.settings.register(this.ID, this.SETTINGS.PACT_ACTOR_ID, {
      name: "Pact-Bound Actor",
      hint: "The actor who has made the pact with Myrkul",
      scope: "world", config: false, type: String, default: null, requiresReload: false
    });
  }

  static registerHooks() {
    V13Compatibility.registerHook("ready", () => {
      // Expose and render widget on ready
      window.MyrkulPactWidget = PactWidget;
      window.MyrkulGMPanel = GMPanel;
      PactWidget.render();
    });

    // Inject a small widget into the pact actor's 5e character sheet
    V13Compatibility.registerHook("renderActorSheet5eCharacter", (app, html) => {
      if (!this.isPactActor(app.actor)) return;
      const actor = app.actor;
      const soulData = this.getActorSoulData(actor);
      const cap = this.calculateSoulCap(actor);

      const widgetHtml = `
        <div class="myrkul-sheet-widget" style="background:linear-gradient(135deg,#1a0f14,#2a1520);border:2px solid #3d1a28;border-radius:6px;padding:12px;margin:8px 0;color:#e8d5d5;">
          <h4 style="color:#a66da6;margin:0 0 8px 0;text-align:center;border-bottom:1px solid #3d1a28;padding-bottom:4px;">Myrkul's Claim</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;align-items:center;">
            <div style="text-align:center;">
              <div style="font-size:1.4em;font-weight:bold;color:#8b4c8e;">
                ${soulData.souls}<span style="font-size:.7em;opacity:.8;">/${cap}</span>
              </div>
              <div style="font-size:.75em;color:#a66da6;">Corruption: ${soulData.corruption}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;">
              <button class="myrkul-spend" data-boon-type="darkBoon">Dark Boon</button>
              <button class="myrkul-spend" data-boon-type="whispers">Whispers</button>
              <button class="myrkul-spend" data-boon-type="focus">Focus</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;">
              <button class="myrkul-toggle">${soulData.enabled ? "Disable" : "Enable"}</button>
              ${(game.user.isGM || actor.isOwner)?`<button class="myrkul-add">Add Soul</button>`:""}
              <button class="myrkul-panel">Open Panel</button>
            </div>
          </div>
        </div>`;
      let insertionPoint = html.find('.tab[data-tab="details"] .resources');
      if (insertionPoint.length===0) insertionPoint = html.find(".resources");
      if (insertionPoint.length===0) insertionPoint = html.find('.tab[data-tab="details"]');
      if (insertionPoint.length>0) {
        insertionPoint.after(widgetHtml);
        html.find(".myrkul-spend").on("click", async (e)=>{ await BoonManager.spendSoul(e.currentTarget.dataset.boonType); app.render(); });
        html.find(".myrkul-toggle").on("click", async ()=>{
          const newEnabled = !soulData.enabled;
          await this.updateActorFlags(actor, { [this.FLAGS.ENABLED]: newEnabled });
          PactWidget.render(); app.render();
        });
        html.find(".myrkul-add").on("click", async ()=>{ await SoulTracker.addSoul(1,"manual"); app.render(); });
        html.find(".myrkul-panel").on("click", ()=> GMPanel.render(true));
      }
    });
  }

  static userCanOpenPanel() {
    const actor = this.getPactActor(); if (!actor) return false;
    return game.user.isGM || actor.isOwner;
  }

  static registerChatCommands() {
    V13Compatibility.registerHook("chatMessage", (log, message) => {
      if (!message.startsWith("!soul")) return true;
      const args = message.trim().split(/\s+/);
      const cmd = (args[1] || "").toLowerCase();

      V13Compatibility.safeAsync(async () => {
        switch (cmd) {
          case "add":   return SoulTracker.addSoul(parseInt(args[2]) || 1, "manual");
          case "spend": {
            const map = { boon:"darkBoon", darkboon:"darkBoon", whispers:"whispers", focus:"focus" };
            const boonType = map[(args[2] || "").toLowerCase()];
            if (!boonType) { ui.notifications.warn("Boon must be boon|whispers|focus"); return false; }
            return BoonManager.spendSoul(boonType);
          }
          case "clear": return SoulTracker.clearSouls();
          case "reset": // reset souls and corruption
            await SoulTracker.clearSouls();
            await SoulTracker.resetCorruption();
            return false;
          case "dec":   return SoulTracker.decreaseCorruption(parseInt(args[2]) || 1);
          case "panel":
          case undefined:
          case "":
            if (!this.userCanOpenPanel()) { ui.notifications.error("Only the pact actor's owner or a GM can open the panel"); return false; }
            GMPanel.render(true); return false;
          case "help":
          default:      return this.showChatHelp();
        }
      });
      return false;
    });
  }

  static async showChatHelp() {
    const help = `
      <div style="background:linear-gradient(135deg,#1a0f14,#2a1520);border:2px solid #3d1a28;border-radius:6px;padding:12px;color:#e8d5d5;">
        <h3 style="color:#a66da6;margin-top:0;">Myrkul's Claim – Manual Commands</h3>
        <p><strong>!soul</strong> or <strong>!soul panel</strong> – Open Pact Panel (pact owner/GM)</p>
        <p><strong>!soul add [n]</strong> – Add soul fragments (default 1)</p>
        <p><strong>!soul spend &lt;boon|whispers|focus&gt;</strong> – Spend a soul for a boon (corruption +1)</p>
        <p><strong>!soul clear</strong> – Clear all souls</p>
        <p><strong>!soul reset</strong> – Reset souls & corruption to 0</p>
        <p><strong>!soul dec [n]</strong> – Decrease corruption by n</p>
      </div>`;
    await V13Compatibility.createChatMessage({ content: help, whisper: [game.user.id] });
    return false;
  }

  static setupAPI() {
    game.modules.get(this.ID).api = {
      addSoul: (actorId, amount=1) => SoulTracker.addSoul(amount,"api",actorId),
      spendSoul: (actorId, type)   => BoonManager.spendSoul(type,actorId),
      decreaseCorruption: (actorId, amt=1) => SoulTracker.decreaseCorruption(amt, actorId),
      resetCorruption: (actorId)   => SoulTracker.resetCorruption(actorId),
      openPanel: () => GMPanel.render(true)
    };
  }

  static isPactActor(actor) {
    if (!actor) return false;
    const pactActorId = game.settings.get(this.ID, this.SETTINGS.PACT_ACTOR_ID);
    return actor.id === pactActorId;
  }
  static getPactActor() {
    const id = game.settings.get(this.ID, this.SETTINGS.PACT_ACTOR_ID);
    return id ? game.actors.get(id) : null;
  }
  static getActorSoulData(actor) {
    if (!actor) return { enabled:false, souls:0, corruption:0, log:[] };
    const flags = actor.flags[this.ID] || {};
    return {
      enabled: flags[this.FLAGS.ENABLED] ?? true, // default enabled for simplicity
      souls: flags[this.FLAGS.SOULS] || 0,
      corruption: flags[this.FLAGS.CORRUPTION] || 0,
      log: flags[this.FLAGS.LOG] || []
    };
  }
  static calculateSoulCap(actor) {
    if (actor?.system?.attributes?.prof) return actor.system.attributes.prof; // proficiency bonus
    return 2; // fallback
  }
  static async updateActorFlags(actor, updates) {
    const currentFlags = actor.flags[this.ID] || {};
    const newFlags = foundry.utils.mergeObject(currentFlags, updates);
    return V13Compatibility.updateActor(actor, { [`flags.${this.ID}`]: newFlags });
  }
  static async logActivity(actor, type, details) {
    const data = this.getActorSoulData(actor);
    const log = [...(data.log || []), { timestamp: Date.now(), type, details }];
    return this.updateActorFlags(actor, { [this.FLAGS.LOG]: log.slice(-100) });
  }
}

/* -----------------------------
 * Initialize & Expose
 * ----------------------------- */
Hooks.once("init", () => {
  console.log("Myrkul's Claim | Initializing...");
  MyrkulClaim.initialize();
});
window.MyrkulClaim = MyrkulClaim;

console.log("Myrkul's Claim | Module loaded successfully");
