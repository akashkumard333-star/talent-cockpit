sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageBox",
  "sap/ui/core/routing/History"
], function (Controller, JSONModel, MessageBox, History) {
  "use strict";

  const SERVICE = "odata/v4/talent";

  function qs(obj) {
    // build query string safely for OData params (not values inside $filter)
    const a = [];
    Object.keys(obj).forEach(k => {
      if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") {
        a.push(`${k}=${obj[k]}`);
      }
    });
    return a.length ? "?" + a.join("&") : "";
  }

  return Controller.extend("project1.controller.View2", {

    onInit: function () {
      this.getView().setModel(new JSONModel({
        busy: false,
        employee: {},
        employeeId: "",
        activeTab: "skills",

        skills: [],
        assignments: [],
        projects: [],
        demands: []
      }), "ui");

      this.getOwnerComponent().getRouter()
        .getRoute("RouteView2")
        .attachPatternMatched(this._onMatched, this);
    },

    onNavBack: function () {
      const oHist = History.getInstance();
      const sPrev = oHist.getPreviousHash();
      if (sPrev !== undefined) {
        window.history.go(-1);
      } else {
        this.getOwnerComponent().getRouter().navTo("RouteView1", {}, true);
      }
    },

    _onMatched: async function (oEvent) {
  const sId = decodeURIComponent(oEvent.getParameter("arguments").employeeId);
  const oUI = this.getView().getModel("ui");
  oUI.setProperty("/employeeId", sId);
  oUI.setProperty("/activeTab", "skills");

  try {
    const r1 = await fetch(`${SERVICE}/Employees(ID=${sId})?$select=ID,name,role,level,location,isActive`, {
      headers: { "Accept": "application/json" }
    });
    if (!r1.ok) throw new Error(`Employee load failed (${r1.status})`);
    oUI.setProperty("/employee", await r1.json());

    // ✅ Load all tab data once so counts are correct
    await Promise.all([
      this._loadSkills(sId),
      this._loadAssignments(sId),
      this._loadProjectsFromAssignments(sId),
      this._loadDemandsForEmployeeProjects(sId)
    ]);

  } catch (e) {
    MessageBox.error(e.message || "Failed to load employee detail");
  }
},

    onTabSelect: async function (oEvent) {
      const sKey = oEvent.getParameter("key");
      const oUI = this.getView().getModel("ui");
      const sId = oUI.getProperty("/employeeId");

      oUI.setProperty("/activeTab", sKey);
      oUI.setProperty("/busy", true);

      try {
        if (sKey === "skills") {
          await this._loadSkills(sId);
        } else if (sKey === "assignments") {
          await this._loadAssignments(sId);
        } else if (sKey === "projects") {
          await this._loadProjectsFromAssignments(sId);
        } else if (sKey === "demands") {
          await this._loadDemandsForEmployeeProjects(sId);
        }
      } catch (e) {
        MessageBox.error(e.message || "Failed to load tab data");
      } finally {
        oUI.setProperty("/busy", false);
      }
    },

    // ✅ OData V4 UUID key syntax for CAP: Employees(ID=<uuid>)
    _loadEmployee: async function (sEmployeeId) {
      const oUI = this.getView().getModel("ui");

      const url =
        `${SERVICE}/Employees(ID=${sEmployeeId})` +
        qs({ "$select": "ID,name,role,level,location,isActive" });

      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`Employee load failed (${res.status})`);

      const data = await res.json();
      oUI.setProperty("/employee", data || {});
    },

    _loadSkills: async function (sEmployeeId) {
      const oUI = this.getView().getModel("ui");

      const url =
        `${SERVICE}/EmployeeSkills` +
        qs({
          "$filter": `employee_ID eq ${sEmployeeId}`,
          "$expand": "skill($select=name,category)",
          "$select": "rating,lastUsedOn,skill_ID"
        });

      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`Skills load failed (${res.status})`);

      const data = await res.json();

      const rows = (data.value || []).map(r => ({
        skillName: r.skill?.name || "",
        category: r.skill?.category || "",
        rating: r.rating,
        lastUsedOn: r.lastUsedOn
      }));

      oUI.setProperty("/skills", rows);
    },

    _loadAssignments: async function (sEmployeeId) {
      const oUI = this.getView().getModel("ui");

      const url =
        `${SERVICE}/Assignments` +
        qs({
          "$filter": `employee_ID eq ${sEmployeeId}`,
          "$expand": "project($select=ID,name)",
          "$select": "allocationPercent,fromDate,toDate,project_ID"
        });

      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`Assignments load failed (${res.status})`);

      const data = await res.json();

      const rows = (data.value || []).map(a => ({
        projectId: a.project_ID,
        projectName: a.project?.name || "",
        allocationPercent: a.allocationPercent,
        fromDate: a.fromDate,
        toDate: a.toDate
      }));

      oUI.setProperty("/assignments", rows);
    },

    _loadProjectsFromAssignments: async function (sEmployeeId) {
      const oUI = this.getView().getModel("ui");

      const url =
        `${SERVICE}/Assignments` +
        qs({
          "$filter": `employee_ID eq ${sEmployeeId}`,
          "$expand": "project($select=ID,name,customer,status,startDate,endDate)",
          "$select": "project_ID"
        });

      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`Projects load failed (${res.status})`);

      const data = await res.json();

      const map = new Map();
      (data.value || []).forEach(r => {
        const p = r.project;
        if (p?.ID && !map.has(p.ID)) map.set(p.ID, p);
      });

      oUI.setProperty("/projects", Array.from(map.values()));
    },

    _loadDemandsForEmployeeProjects: async function (sEmployeeId) {
      const oUI = this.getView().getModel("ui");

      // 1) Load employee assignments -> project IDs
      const aUrl =
        `${SERVICE}/Assignments` +
        qs({
          "$filter": `employee_ID eq ${sEmployeeId}`,
          "$expand": "project($select=ID,name)",
          "$select": "project_ID"
        });

      const aRes = await fetch(aUrl, { headers: { Accept: "application/json" } });
      if (!aRes.ok) throw new Error(`Assignments load failed (${aRes.status})`);

      const aData = await aRes.json();
      const aAssignments = aData.value || [];

      const aProjectIds = [...new Set(aAssignments.map(a => a.project_ID).filter(Boolean))];

      if (!aProjectIds.length) {
        oUI.setProperty("/demands", []);
        return;
      }

      // 2) Build OData OR filter: project_ID eq <id1> or project_ID eq <id2>
      const sProjFilter = aProjectIds.map(id => `project_ID eq ${id}`).join(" or ");

      // 3) Load ProjectDemands for those projects
      const dUrl =
        `${SERVICE}/ProjectDemands` +
        qs({
          "$filter": sProjFilter,
          "$expand": "requiredSkill($select=name),project($select=ID,name)",
          "$select": "minRating,neededFrom,neededTo,project_ID,requiredSkill_ID"
        });

      const dRes = await fetch(dUrl, { headers: { Accept: "application/json" } });
      if (!dRes.ok) throw new Error(`Demands load failed (${dRes.status})`);

      const dData = await dRes.json();

      const rows = (dData.value || []).map(d => ({
        projectName: d.project?.name || "",
        skillName: d.requiredSkill?.name || "",
        minRating: d.minRating,
        neededFrom: d.neededFrom,
        neededTo: d.neededTo
      }));

      oUI.setProperty("/demands", rows);
    },

    onEdit: function () {
      const sId = this.getView().getModel("ui").getProperty("/employeeId");
      this.getOwnerComponent().getRouter().navTo("RouteView3", {
        employeeId: encodeURIComponent(sId)
      });
    }

  });
});
