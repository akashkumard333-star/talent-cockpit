sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "sap/ui/core/routing/History"
], function (Controller, JSONModel, MessageBox, MessageToast, History) {
  "use strict";

  const SERVICE = "odata/v4/talent";

  const deepClone = (o) => JSON.parse(JSON.stringify(o || {}));

  // OData V4 CAP UUID-key access pattern
  const empKey = (id) => `Employees(ID=${id})`;
  const projKey = (id) => `Projects(ID=${id})`;
  const assKey = (id) => `Assignments(ID=${id})`;
  const demKey = (id) => `ProjectDemands(ID=${id})`;
  const empSkillKey = (empId, skillId) => `EmployeeSkills(employee_ID=${empId},skill_ID=${skillId})`;

  async function http(url, opts = {}) {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "Content-Type": "application/json", ...(opts.headers || {}) },
      ...opts
    });
    return res;
  }

  return Controller.extend("project1.controller.View3", {

    onInit: function () {
      this.getView().setModel(new JSONModel({
        busy: false,
        canSave: false,

        employeeId: "",
        employee: {},

        // lookups
        allSkills: [],
        allProjects: [],

        // editable data
        skills: [],
        assignments: [],
        projects: [],
        demands: [],

        // backups for cancel
        _backup: {
          employee: {},
          skills: [],
          assignments: [],
          projects: [],
          demands: []
        },

        // selection flags
        skillsHasSelection: false,
        assignHasSelection: false,
        projHasSelection: false,
        demHasSelection: false
      }), "ui");

      this.getOwnerComponent().getRouter()
        .getRoute("RouteView3")
        .attachPatternMatched(this._onMatched, this);
    },

    onNavBack: function () {
      const oHist = History.getInstance();
      const sPrev = oHist.getPreviousHash();
      if (sPrev !== undefined) {
        window.history.go(-1);
      } else {
        const sId = this.getView().getModel("ui").getProperty("/employeeId");
        this.getOwnerComponent().getRouter().navTo("RouteView2", { employeeId: encodeURIComponent(sId) }, true);
      }
    },

    _onMatched: async function (oEvent) {
      const sId = decodeURIComponent(oEvent.getParameter("arguments").employeeId || "");
      const oUI = this.getView().getModel("ui");

      oUI.setProperty("/employeeId", sId);
      oUI.setProperty("/busy", true);
      oUI.setProperty("/canSave", false);

      try {
        await this._loadLookups();
        await this._loadAllEditableData(sId);

        // backup for cancel
        oUI.setProperty("/_backup", {
          employee: deepClone(oUI.getProperty("/employee")),
          skills: deepClone(oUI.getProperty("/skills")),
          assignments: deepClone(oUI.getProperty("/assignments")),
          projects: deepClone(oUI.getProperty("/projects")),
          demands: deepClone(oUI.getProperty("/demands"))
        });

      } catch (e) {
        MessageBox.error(e.message || "Failed to load edit data");
      } finally {
        oUI.setProperty("/busy", false);
      }
    },

    _loadLookups: async function () {
      const oUI = this.getView().getModel("ui");

      // Skills lookup
      const sRes = await http(`${SERVICE}/Skills?$select=ID,name,category&$orderby=name`);
      if (!sRes.ok) throw new Error(`Skills lookup failed (${sRes.status})`);
      const sData = await sRes.json();
      oUI.setProperty("/allSkills", sData.value || []);

      // Projects lookup (for assignment + demands dropdowns)
      const pRes = await http(`${SERVICE}/Projects?$select=ID,name,customer,status,startDate,endDate&$orderby=name`);
      if (!pRes.ok) throw new Error(`Projects lookup failed (${pRes.status})`);
      const pData = await pRes.json();
      oUI.setProperty("/allProjects", (pData.value || []).map(p => ({ ID: p.ID, name: p.name })));

      // also keep full projects list editable later loaded separately
    },

    _loadAllEditableData: async function (sEmployeeId) {
      const oUI = this.getView().getModel("ui");

      // Employee
      const eRes = await http(`${SERVICE}/${empKey(sEmployeeId)}?$select=ID,name,role,level,location,isActive`);
      if (!eRes.ok) throw new Error(`Employee load failed (${eRes.status})`);
      oUI.setProperty("/employee", await eRes.json());

      // EmployeeSkills (editable)
      const esRes = await http(
        `${SERVICE}/EmployeeSkills?$filter=employee_ID eq ${sEmployeeId}`
        + `&$expand=skill($select=ID,name,category)`
        + `&$select=employee_ID,skill_ID,rating,lastUsedOn`
      );
      if (!esRes.ok) throw new Error(`EmployeeSkills load failed (${esRes.status})`);
      const esData = await esRes.json();
      oUI.setProperty("/skills", (esData.value || []).map(r => ({
        employee_ID: r.employee_ID,
        skill_ID: r.skill_ID,
        skillName: r.skill?.name || "",
        category: r.skill?.category || "",
        rating: r.rating,
        lastUsedOn: r.lastUsedOn,
        _isNew: false
      })));

      // Assignments (editable)
      const aRes = await http(
        `${SERVICE}/Assignments?$filter=employee_ID eq ${sEmployeeId}`
        + `&$select=ID,employee_ID,project_ID,allocationPercent,fromDate,toDate`
      );
      if (!aRes.ok) throw new Error(`Assignments load failed (${aRes.status})`);
      const aData = await aRes.json();
      oUI.setProperty("/assignments", (aData.value || []).map(x => ({ ...x, _isNew: false })));

      // Projects editable (we load all projects that this employee is assigned to)
      const apRes = await http(
        `${SERVICE}/Assignments?$filter=employee_ID eq ${sEmployeeId}`
        + `&$expand=project($select=ID,name,customer,status,startDate,endDate)`
        + `&$select=project_ID`
      );
      if (!apRes.ok) throw new Error(`Assignments(project expand) failed (${apRes.status})`);
      const apData = await apRes.json();

      const m = new Map();
      (apData.value || []).forEach(r => {
        const p = r.project;
        if (p?.ID && !m.has(p.ID)) m.set(p.ID, { ...p, _isNew: false });
      });
      oUI.setProperty("/projects", Array.from(m.values()));

      // Demands editable (only demands for employee project IDs)
      await this._loadDemandsForEmployeeProjects(sEmployeeId);

      // clear selections
      this._clearSelections();
    },

    _loadDemandsForEmployeeProjects: async function (sEmployeeId) {
      const oUI = this.getView().getModel("ui");

      const aRes = await http(`${SERVICE}/Assignments?$filter=employee_ID eq ${sEmployeeId}&$select=project_ID`);
      if (!aRes.ok) throw new Error(`Assignments(for demands) failed (${aRes.status})`);
      const aData = await aRes.json();
      const aProj = [...new Set((aData.value || []).map(x => x.project_ID).filter(Boolean))];

      if (!aProj.length) {
        oUI.setProperty("/demands", []);
        return;
      }

      const sFilter = aProj.map(id => `project_ID eq ${id}`).join(" or ");

      const dRes = await http(
        `${SERVICE}/ProjectDemands?$filter=${sFilter}`
        + `&$select=ID,project_ID,requiredSkill_ID,minRating,neededFrom,neededTo`
      );
      if (!dRes.ok) throw new Error(`ProjectDemands load failed (${dRes.status})`);
      const dData = await dRes.json();

      oUI.setProperty("/demands", (dData.value || []).map(x => ({ ...x, _isNew: false })));
    },

    // -----------------------------
    // Dirty tracking
    // -----------------------------
    markDirty: function () {
      this.getView().getModel("ui").setProperty("/canSave", true);
    },

    onSkillChanged: function (oEvent) {
      // update skillName/category when skill_ID changed
      const oUI = this.getView().getModel("ui");
      const oItem = oEvent.getSource().getSelectedItem();
      const sSkillId = oEvent.getSource().getSelectedKey();

      const aAll = oUI.getProperty("/allSkills") || [];
      const oSkill = aAll.find(x => x.ID === sSkillId);

      const oCtx = oEvent.getSource().getBindingContext("ui");
      if (oCtx) {
        oCtx.getModel().setProperty(oCtx.getPath() + "/skillName", oItem ? oItem.getText() : "");
        oCtx.getModel().setProperty(oCtx.getPath() + "/category", oSkill ? oSkill.category : "");
      }

      this.markDirty();
    },

    // -----------------------------
    // Add / Delete row handlers
    // -----------------------------
    onAddSkill: function () {
      const oUI = this.getView().getModel("ui");
      const sEmp = oUI.getProperty("/employeeId");
      const a = oUI.getProperty("/skills") || [];
      a.unshift({
        employee_ID: sEmp,
        skill_ID: (oUI.getProperty("/allSkills")?.[0]?.ID) || "",
        skillName: "",
        category: "",
        rating: 3,
        lastUsedOn: null,
        _isNew: true
      });
      oUI.setProperty("/skills", a);
      this.markDirty();
    },

    onDeleteSkill: function () {
      const oTbl = this.byId("tblSkillsEdit");
      const aSel = oTbl.getSelectedContexts("ui");
      if (!aSel.length) return;

      const oUI = this.getView().getModel("ui");
      let a = oUI.getProperty("/skills") || [];
      const setPaths = new Set(aSel.map(c => c.getPath()));
      a = a.filter((row, idx) => !setPaths.has(`/skills/${idx}`));
      oUI.setProperty("/skills", a);

      oTbl.removeSelections(true);
      oUI.setProperty("/skillsHasSelection", false);
      this.markDirty();
    },

    onAddAssignment: function () {
      const oUI = this.getView().getModel("ui");
      const sEmp = oUI.getProperty("/employeeId");
      const a = oUI.getProperty("/assignments") || [];
      a.unshift({
        ID: null,
        employee_ID: sEmp,
        project_ID: (oUI.getProperty("/allProjects")?.[0]?.ID) || "",
        allocationPercent: 50,
        fromDate: null,
        toDate: null,
        _isNew: true
      });
      oUI.setProperty("/assignments", a);
      this.markDirty();
    },

    onDeleteAssignment: function () {
      const oTbl = this.byId("tblAssignEdit");
      const aSel = oTbl.getSelectedContexts("ui");
      if (!aSel.length) return;

      const oUI = this.getView().getModel("ui");
      let a = oUI.getProperty("/assignments") || [];
      const setPaths = new Set(aSel.map(c => c.getPath()));
      a = a.filter((row, idx) => !setPaths.has(`/assignments/${idx}`));
      oUI.setProperty("/assignments", a);

      oTbl.removeSelections(true);
      oUI.setProperty("/assignHasSelection", false);
      this.markDirty();
    },

    onAddProject: function () {
      const oUI = this.getView().getModel("ui");
      const a = oUI.getProperty("/projects") || [];
      a.unshift({
        ID: null,
        name: "",
        customer: "",
        status: "Planned",
        startDate: null,
        endDate: null,
        _isNew: true
      });
      oUI.setProperty("/projects", a);
      this.markDirty();
    },

    onDeleteProject: function () {
      const oTbl = this.byId("tblProjEdit");
      const aSel = oTbl.getSelectedContexts("ui");
      if (!aSel.length) return;

      const oUI = this.getView().getModel("ui");
      let a = oUI.getProperty("/projects") || [];
      const setPaths = new Set(aSel.map(c => c.getPath()));
      a = a.filter((row, idx) => !setPaths.has(`/projects/${idx}`));
      oUI.setProperty("/projects", a);

      oTbl.removeSelections(true);
      oUI.setProperty("/projHasSelection", false);
      this.markDirty();
    },

    onAddDemand: function () {
      const oUI = this.getView().getModel("ui");
      const a = oUI.getProperty("/demands") || [];
      a.unshift({
        ID: null,
        project_ID: (oUI.getProperty("/allProjects")?.[0]?.ID) || "",
        requiredSkill_ID: (oUI.getProperty("/allSkills")?.[0]?.ID) || "",
        minRating: 3,
        neededFrom: null,
        neededTo: null,
        _isNew: true
      });
      oUI.setProperty("/demands", a);
      this.markDirty();
    },

    onDeleteDemand: function () {
      const oTbl = this.byId("tblDemEdit");
      const aSel = oTbl.getSelectedContexts("ui");
      if (!aSel.length) return;

      const oUI = this.getView().getModel("ui");
      let a = oUI.getProperty("/demands") || [];
      const setPaths = new Set(aSel.map(c => c.getPath()));
      a = a.filter((row, idx) => !setPaths.has(`/demands/${idx}`));
      oUI.setProperty("/demands", a);

      oTbl.removeSelections(true);
      oUI.setProperty("/demHasSelection", false);
      this.markDirty();
    },

    // -----------------------------
    // Selection flags
    // -----------------------------
    onSkillsSelectionChange: function (oEvent) {
      this.getView().getModel("ui").setProperty("/skillsHasSelection", oEvent.getSource().getSelectedItems().length > 0);
    },
    onAssignSelectionChange: function (oEvent) {
      this.getView().getModel("ui").setProperty("/assignHasSelection", oEvent.getSource().getSelectedItems().length > 0);
    },
    onProjSelectionChange: function (oEvent) {
      this.getView().getModel("ui").setProperty("/projHasSelection", oEvent.getSource().getSelectedItems().length > 0);
    },
    onDemSelectionChange: function (oEvent) {
      this.getView().getModel("ui").setProperty("/demHasSelection", oEvent.getSource().getSelectedItems().length > 0);
    },

    _clearSelections: function () {
      const oUI = this.getView().getModel("ui");
      ["tblSkillsEdit", "tblAssignEdit", "tblProjEdit", "tblDemEdit"].forEach(id => {
        const t = this.byId(id);
        if (t) t.removeSelections(true);
      });
      oUI.setProperty("/skillsHasSelection", false);
      oUI.setProperty("/assignHasSelection", false);
      oUI.setProperty("/projHasSelection", false);
      oUI.setProperty("/demHasSelection", false);
    },

    // -----------------------------
    // Cancel = restore backup + back to details
    // -----------------------------
    onCancel: function () {
      const oUI = this.getView().getModel("ui");
      const b = oUI.getProperty("/_backup");

      oUI.setProperty("/employee", deepClone(b.employee));
      oUI.setProperty("/skills", deepClone(b.skills));
      oUI.setProperty("/assignments", deepClone(b.assignments));
      oUI.setProperty("/projects", deepClone(b.projects));
      oUI.setProperty("/demands", deepClone(b.demands));

      oUI.setProperty("/canSave", false);

      const sId = oUI.getProperty("/employeeId");
      this.getOwnerComponent().getRouter().navTo("RouteView2", { employeeId: encodeURIComponent(sId) }, true);
    },

    // -----------------------------
    // Save = persist all tabs + back to details
    // -----------------------------
    onSave: async function () {
      const oUI = this.getView().getModel("ui");
      const sEmpId = oUI.getProperty("/employeeId");

      oUI.setProperty("/busy", true);

      try {
        await this._saveEmployee(sEmpId);
        await this._saveEmployeeSkills(sEmpId);
        await this._saveAssignments(sEmpId);
        await this._saveProjects();
        await this._saveDemands();

        MessageToast.show("Saved");

        // go back to details page
        this.getOwnerComponent().getRouter().navTo("RouteView2", { employeeId: encodeURIComponent(sEmpId) }, true);

      } catch (e) {
        MessageBox.error(e.message || "Save failed");
      } finally {
        oUI.setProperty("/busy", false);
      }
    },

    _saveEmployee: async function (sEmpId) {
      const oUI = this.getView().getModel("ui");
      const cur = oUI.getProperty("/employee");
      const bak = oUI.getProperty("/_backup/employee");

      // quick check
      if (JSON.stringify(cur) === JSON.stringify(bak)) return;

      const payload = {
        name: cur.name,
        role: cur.role,
        level: cur.level,
        location: cur.location,
        isActive: !!cur.isActive
      };

      const res = await http(`${SERVICE}/${empKey(sEmpId)}`, { method: "PATCH", body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(`Employee save failed (${res.status})`);
    },

    _saveEmployeeSkills: async function (sEmpId) {
      const oUI = this.getView().getModel("ui");
      const cur = oUI.getProperty("/skills") || [];
      const bak = oUI.getProperty("/_backup/skills") || [];

      const bakKeySet = new Set(bak.map(x => `${x.employee_ID}::${x.skill_ID}`));
      const curKeySet = new Set(cur.map(x => `${x.employee_ID}::${x.skill_ID}`));

      // deletes
      for (const oldRow of bak) {
        const key = `${oldRow.employee_ID}::${oldRow.skill_ID}`;
        if (!curKeySet.has(key)) {
          const delRes = await http(`${SERVICE}/${empSkillKey(sEmpId, oldRow.skill_ID)}`, { method: "DELETE" });
          if (!delRes.ok) throw new Error(`Skill delete failed (${delRes.status})`);
        }
      }

      // creates + updates
      for (const row of cur) {
        const key = `${row.employee_ID}::${row.skill_ID}`;
        const payload = { employee_ID: sEmpId, skill_ID: row.skill_ID, rating: row.rating, lastUsedOn: row.lastUsedOn };

        if (!bakKeySet.has(key) || row._isNew) {
          const cRes = await http(`${SERVICE}/EmployeeSkills`, { method: "POST", body: JSON.stringify(payload) });
          if (!cRes.ok) throw new Error(`Skill create failed (${cRes.status})`);
        } else {
          // update rating/lastUsedOn
          const uRes = await http(`${SERVICE}/${empSkillKey(sEmpId, row.skill_ID)}`, { method: "PATCH", body: JSON.stringify({ rating: row.rating, lastUsedOn: row.lastUsedOn }) });
          if (!uRes.ok) throw new Error(`Skill update failed (${uRes.status})`);
        }
      }
    },

    _saveAssignments: async function (sEmpId) {
      const oUI = this.getView().getModel("ui");
      const cur = oUI.getProperty("/assignments") || [];
      const bak = oUI.getProperty("/_backup/assignments") || [];

      const bakById = new Map(bak.filter(x => x.ID).map(x => [x.ID, x]));
      const curById = new Map(cur.filter(x => x.ID).map(x => [x.ID, x]));

      // deletes
      for (const oldRow of bak) {
        if (oldRow.ID && !curById.has(oldRow.ID)) {
          const delRes = await http(`${SERVICE}/${assKey(oldRow.ID)}`, { method: "DELETE" });
          if (!delRes.ok) throw new Error(`Assignment delete failed (${delRes.status})`);
        }
      }

      // creates + updates
      for (const row of cur) {
        const payload = {
          employee_ID: sEmpId,
          project_ID: row.project_ID,
          allocationPercent: row.allocationPercent,
          fromDate: row.fromDate,
          toDate: row.toDate
        };

        if (!row.ID || row._isNew) {
          const cRes = await http(`${SERVICE}/Assignments`, { method: "POST", body: JSON.stringify(payload) });
          if (!cRes.ok) throw new Error(`Assignment create failed (${cRes.status})`);
        } else {
          const old = bakById.get(row.ID);
          if (old && JSON.stringify(payload) === JSON.stringify({
            employee_ID: old.employee_ID,
            project_ID: old.project_ID,
            allocationPercent: old.allocationPercent,
            fromDate: old.fromDate,
            toDate: old.toDate
          })) continue;

          const uRes = await http(`${SERVICE}/${assKey(row.ID)}`, { method: "PATCH", body: JSON.stringify(payload) });
          if (!uRes.ok) throw new Error(`Assignment update failed (${uRes.status})`);
        }
      }
    },

    _saveProjects: async function () {
      const oUI = this.getView().getModel("ui");
      const cur = oUI.getProperty("/projects") || [];
      const bak = oUI.getProperty("/_backup/projects") || [];

      const bakById = new Map(bak.filter(x => x.ID).map(x => [x.ID, x]));
      const curById = new Map(cur.filter(x => x.ID).map(x => [x.ID, x]));

      // deletes (optional: only if you really want deleting Projects from DB)
      for (const oldRow of bak) {
        if (oldRow.ID && !curById.has(oldRow.ID)) {
          const delRes = await http(`${SERVICE}/${projKey(oldRow.ID)}`, { method: "DELETE" });
          if (!delRes.ok) throw new Error(`Project delete failed (${delRes.status})`);
        }
      }

      // creates + updates
      for (const row of cur) {
        const payload = {
          name: row.name,
          customer: row.customer,
          status: row.status,
          startDate: row.startDate,
          endDate: row.endDate
        };

        if (!row.ID || row._isNew) {
          const cRes = await http(`${SERVICE}/Projects`, { method: "POST", body: JSON.stringify(payload) });
          if (!cRes.ok) throw new Error(`Project create failed (${cRes.status})`);
        } else {
          const old = bakById.get(row.ID);
          if (old && JSON.stringify(payload) === JSON.stringify({
            name: old.name,
            customer: old.customer,
            status: old.status,
            startDate: old.startDate,
            endDate: old.endDate
          })) continue;

          const uRes = await http(`${SERVICE}/${projKey(row.ID)}`, { method: "PATCH", body: JSON.stringify(payload) });
          if (!uRes.ok) throw new Error(`Project update failed (${uRes.status})`);
        }
      }
    },

    _saveDemands: async function () {
      const oUI = this.getView().getModel("ui");
      const cur = oUI.getProperty("/demands") || [];
      const bak = oUI.getProperty("/_backup/demands") || [];

      const bakById = new Map(bak.filter(x => x.ID).map(x => [x.ID, x]));
      const curById = new Map(cur.filter(x => x.ID).map(x => [x.ID, x]));

      // deletes
      for (const oldRow of bak) {
        if (oldRow.ID && !curById.has(oldRow.ID)) {
          const delRes = await http(`${SERVICE}/${demKey(oldRow.ID)}`, { method: "DELETE" });
          if (!delRes.ok) throw new Error(`Demand delete failed (${delRes.status})`);
        }
      }

      // creates + updates
      for (const row of cur) {
        const payload = {
          project_ID: row.project_ID,
          requiredSkill_ID: row.requiredSkill_ID,
          minRating: row.minRating,
          neededFrom: row.neededFrom,
          neededTo: row.neededTo
        };

        if (!row.ID || row._isNew) {
          const cRes = await http(`${SERVICE}/ProjectDemands`, { method: "POST", body: JSON.stringify(payload) });
          if (!cRes.ok) throw new Error(`Demand create failed (${cRes.status})`);
        } else {
          const old = bakById.get(row.ID);
          if (old && JSON.stringify(payload) === JSON.stringify({
            project_ID: old.project_ID,
            requiredSkill_ID: old.requiredSkill_ID,
            minRating: old.minRating,
            neededFrom: old.neededFrom,
            neededTo: old.neededTo
          })) continue;

          const uRes = await http(`${SERVICE}/${demKey(row.ID)}`, { method: "PATCH", body: JSON.stringify(payload) });
          if (!uRes.ok) throw new Error(`Demand update failed (${uRes.status})`);
        }
      }
    },

    onTabSelect: function () {
      // optional – you can keep empty
    }

  });
});
