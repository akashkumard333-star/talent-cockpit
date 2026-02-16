namespace talent;

entity Employees {
  key ID          : UUID;
      name        : String(100);
      role        : String(50);
      level       : String(20);
      location    : String(50);
      isActive    : Boolean default true;
}

entity Skills {
  key ID          : UUID;
      name        : String(80);
      category    : String(50);
}

entity EmployeeSkills {
  key employee    : Association to Employees;
  key skill       : Association to Skills;
      rating : Integer @assert.range: [1, 5];
      lastUsedOn  : Date;
}

entity Projects {
  key ID          : UUID;
      name        : String(120);
      customer    : String(120);
      startDate   : Date;
      endDate     : Date;
      status      : String(20); // Planned, Active, Closed
}

entity ProjectDemands {
  key ID          : UUID;
      project     : Association to Projects;
      requiredSkill : Association to Skills;
      minRating   : Integer @assert.range: [1, 5];
      neededFrom  : Date;
      neededTo    : Date;
}

entity Assignments {
  key ID          : UUID;
      employee    : Association to Employees;
      project     : Association to Projects;
      allocationPercent : Integer @assert.range: [1, 100];
      fromDate    : Date;
      toDate      : Date;
}
