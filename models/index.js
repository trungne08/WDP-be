// Export tất cả models để dễ import
module.exports = {
    Admin: require('./Admin'),
    Lecturer: require('./Lecturer'),
    Student: require('./Student'),
    Semester: require('./Semester'),
    Class: require('./Class'),
    Team: require('./Team'),
    TeamMember: require('./TeamMember'),
    Sprint: require('./JiraData').Sprint,
    JiraTask: require('./JiraData').JiraTask,
    GithubCommit: require('./GitData'),
    PeerReview: require('./Assessment').PeerReview,
    SprintAssessment: require('./Assessment').SprintAssessment,
    RiskAlert: require('./RiskAlert'),
    OTP: require('./OTP'),
    RefreshToken: require('./RefreshToken'),
    PendingEnrollment: require('./PendingEnrollment')
};
