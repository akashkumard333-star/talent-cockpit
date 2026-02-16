const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {
  const { Employees, EmployeeSkills, ProjectDemands, Assignments } = this.entities;

  this.on('RecommendEmployeesForProject', async (req) => {
    const { projectID } = req.data;

    const demands = await SELECT.from(ProjectDemands).where({ project_ID: projectID });

    // Simple example: just match first demand
    const demand = demands[0];
    if (!demand) return [];

    const candidates = await SELECT
      .from(EmployeeSkills)
      .where({ skill_ID: demand.requiredSkill_ID, rating: { '>=': demand.minRating } });

    // TODO: filter by availability using Assignments
    const employeeIDs = candidates.map(c => c.employee_ID);

    const employees = await SELECT.from(Employees).where({ ID: employeeIDs });

    return employees;
  });
});
