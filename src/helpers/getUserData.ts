export const getUserData = (user: any) => {
  if (!user || typeof user !== 'object') {
    throw new Error('Invalid user object provided.');
  }

  const {fullName, caseIds, dateOfInjury} = user;

  if (!fullName || typeof fullName !== 'string' || !fullName.includes(' ')) {
    throw new Error('Invalid or missing fullName.');
  }

  if (!caseIds) {
    throw new Error('caseIds are missing.');
  }

  if (!dateOfInjury) {
    throw new Error('dateOfInjury is missing.');
  }

  const lastName = fullName.split(' ')[1];

  return {
    claimNumber: caseIds,
    dateOfInjury: dateOfInjury,
    lastName: lastName,
  };
};
