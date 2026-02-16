using talent from '../db/schema';

service TalentService {

  entity Employees       as projection on talent.Employees;
  entity Skills          as projection on talent.Skills;
  entity EmployeeSkills  as projection on talent.EmployeeSkills;
  entity Projects        as projection on talent.Projects;
  entity ProjectDemands  as projection on talent.ProjectDemands;
  entity Assignments     as projection on talent.Assignments;

  action RecommendEmployeesForProject(projectID : UUID) returns many Employees;

}


