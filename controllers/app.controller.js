const jwt = require("jsonwebtoken");
const db = require("../models");
const config = require("../config/auth.config");
const GmailService = require("../services/gmail-service");
const { resolveContent } = require("nodemailer/lib/shared");
const Forms = db.formModels.Forms;
const Fields = db.formModels.FieldTypes;
const ApprovalRequests = db.approvalModels.ApprovalRequests;
const Approvals = db.approvalModels.Approvals;
const Approvers = db.approverModels.Approvers;
const Roles = db.approverModels.Roles;
const Departments = db.approverModels.Departments;

var bcrypt = require("bcryptjs");

exports.getAllForms = (req, res) => {
  // Forms.find({}).then((data) => res.json(data));
  Forms.find({})
    .populate("finals")
    .exec((err, resp) => {
      if (err) {
        res.status(500).send({ message: err });
      } else {
        res.status(200).send(resp);
      }
    });
};

exports.getRoles = (req, res) => {
  Roles.find({}).exec((err, roles) => {
    if (err) {
      res.status(500).send({ message: err });
    } else {
      res.status(200).send(roles);
    }
  });
};

exports.getApprovers = (req, res) => {
  // Approvers.find({}).then((data) => res.json(data));

  Approvers.find({})
    .populate("role")
    .exec((err, approvers) => {
      if (err) {
        res.status(500).send({ message: err });
      } else {
        res.status(200).send(approvers);
      }
    });
};

exports.getApproversWithoutMod = (req, res) => {
  Approvers.find({ username: { $ne: "mod" } })
    .populate("role")
    .exec((err, approvers) => {
      if (err) {
        console.log(err);
        res.status(500).send({ message: err });
      } else {
        console.log("success");
        res.status(200).send(approvers);
      }
    });
};

exports.getForm = (req, res) => {
  Forms.findOne({
    _id: req.body.id,
  }).exec((err, form) => {
    if (err) {
      res.status(500).send({ message: err });
    } else {
      var fields_arr = [];
      findFieldTypes(form.fields).then((return_val) => {
        fields_arr = return_val;

        const body = {
          _id: form._id,
          fields: return_val,
          name: form.name,
        };
        res.status(200).send(body);
      });
    }
  });
};

exports.getDashboardApprovalRequests = (req, res) => {
  ApprovalRequests.find({
    date_submitted: {
      $gte: req.body.min_date,
      $lt: req.body.max_date,
    },
  })
    .select(
      "final_approval filled_by form department date_submitted approval_date"
    )
    .populate("form")
    .exec((err, approvals) => {
      if (err) {
        res.status(500).send({ message: err });
      } else {
        res.status(200).send(approvals);
      }
    });
};

exports.getAllApprovalRequests = (req, res) => {
  // ApprovalRequests.find({}).then((data) => res.json(data));
  if (req.headers) {
    var decoded = jwt.verify(req.headers["x-access-token"], config.secret);

    switch (decoded.role.level) {
      case 1:
        getApprovalRequestsfromDB(req, res, {
          department: decoded.role.department.name,
          date_submitted: {
            $gte: req.body.min_date,
            $lt: req.body.max_date,
          },
        });
        break;
      case 2:
        getApprovalRequestsfromDB(req, res, {
          date_submitted: {
            $gte: req.body.min_date,
            $lt: req.body.max_date,
          },
        });
        break;
      case 3:
        getApprovalRequestsfromDB(req, res, {
          date_submitted: {
            $gte: req.body.min_date,
            $lt: req.body.max_date,
          },
        });
        break;
      default:
        res.status(401).send({ message: "Unauthorized!" });
        break;
    }
  }
};

let getApprovalRequestsfromDB = async (req, res, criteria) => {
  await ApprovalRequests.find(criteria)
    .select("filled_by approval form date_submitted")
    .populate("form", "name")
    .populate({
      path: "approval",
      populate: { path: "approver" },
    })
    .exec((err, approvals) => {
      if (err) {
        res.status(500).send({ message: err });
        return;
      }

      res.status(200).send(approvals);
    });
};

exports.getApprovalRequest = (req, res) => {
  ApprovalRequests.findOne({
    _id: req.body.id,
  })
    .select("filled_by fields form approval date_submitted department")
    .populate("approval")
    .populate("form")
    .exec((err, data) => {
      if (err) {
        res.status(500).send({ message: err });
      } else {
        let found = false;
        var approver = undefined;
        for (let app of data.approval) {
          if (app.approver == req.body.approver) {
            found = true;
            approver = app;
            console.log(approver);
          }
        }
        if (found && approver) {
          const send_data = {
            filled_by: data.filled_by,
            fields: data.fields,
            form: data.form,
            approval: approver,
            date_submitted: data.date_submitted,
            department: data.department,
          };

          res.status(200).send(send_data);
        } else {
          const send_data = {
            filled_by: data.filled_by,
            fields: data.fields,
            form: data.form,
            approval: null,
            date_submitted: data.date_submitted,
            department: data.department,
          };
          res.status(200).send(send_data);
        }
      }
    });
};

exports.updateApproval = (req, res) => {
  ApprovalRequests.findOne({ _id: req.body.request_id })
    .select("approval form final_approval")
    .populate("approval")
    .populate("form")
    .exec((err, request) => {
      if (err) {
        res.status(500).send({ message: err });
      } else {
        for (let app of request.approval) {
          if (app.approver == req.body.approver) {
            const now = new Date();

            Approvals.findByIdAndUpdate(
              app,
              {
                $set: {
                  status: req.body.action,
                  comments: req.body.comments,
                  date_approved: now,
                },
              },
              (err, resp) => {
                if (err) {
                  console.log(err);
                  res
                    .status(401)
                    .send({ message: "Unable to update approval" });
                } else {
                  // update if final
                  const isInArr = request.form.finals.some((a) => {
                    return a.equals(app.approver);
                  });
                  if (request.final_approval == 0 && isInArr) {
                    ApprovalRequests.findByIdAndUpdate(
                      req.body.request_id,
                      {
                        $set: {
                          final_approval: req.body.action,
                          approval_date: now,
                        },
                      },
                      (rErr, rResp) => {
                        if (err) {
                          res
                            .status(401)
                            .send({ message: "Unable to update approval" });
                        } else {
                          res
                            .status(200)
                            .send({ message: "Approval Updated!" });
                        }
                      }
                    );
                  } else {
                    res.status(200).send({ message: "Approval Updated!" });
                  }
                }
              }
            );
          }
        }
      }
    });
};

exports.sendForm = (req, res) => {
  const approvals = req.body.approval;

  createApprovals(approvals)
    .then((return_val) => {
      const body = {
        fields: req.body.fields,
        filled_by: req.body.filled_by,
        form_title: req.body.form_title,
        approval: return_val,
        form: req.body.form_id,
        department: req.body.department,
      };

      ApprovalRequests.create(body, (check_keys = false)).then((resp) => {
        res.status(200).send({ message: "Submitted request successfully!" });

        Forms.findByIdAndUpdate(req.body.form_id, {
          $inc: { counter: 1 },
        }).exec();

        getApproverEmails(resp.approval).then((ret_approvers) => {
          console.log(ret_approvers);
          for (let a of ret_approvers) {
            if (a) {
              console.log("sending email to " + a);
              sendMail(
                a,
                "AspenForms: Approval Requested",
                process.env.APP_BASE_URL + "/form/" + resp._id
              );
            }
          }
        });
        // ** send mail here **
      });
    })
    .catch((e) => {
      res.status(401).send({ message: e });
    });
};

let createApprovals = async (approvals) => {
  let return_approvals = [];

  if (approvals) {
    try {
      for (let app of approvals) {
        const body = {
          approver: app,
          status: 0,
          comments: "",
        };

        await Approvals.create(body, (check_keys = false)).then((appr) => {
          return_approvals.push(appr._id);
          // Send mail
        });
      }

      return return_approvals;
    } catch (e) {}
  } else {
    throw new Error("Approvals empty");
  }
};

let findFieldTypes = async (form_fields) => {
  let return_arr = [];

  if (form_fields) {
    try {
      for (let field_type of form_fields) {
        let action = await Fields.findOne({
          _id: field_type.type,
        }).exec();

        return_arr.push({
          _id: field_type._id,
          name: field_type.name,
          required: field_type.required,
          type: action,
        });
      }

      return return_arr;
    } catch (e) {}
  }
};

exports.sendmail = (req, res) => {
  let mailOptions = {
    from: "aspenforms@ke.betashelys.com",
    to: "robertm@ke.betashelys.com",
    subject: "Nodemailer",
    html: "<a href=`#`>Click here</a> to review approval request",
  };

  GmailService.transporter.sendMail(mailOptions, (err, data) => {
    if (err) {
      console.log(err);
      res.status(500).send({ message: "Error sending email" });
    } else {
      res.status(200).send({ message: "Email sent" });
    }
  });
};

let getApproverEmails = async (approval_request) => {
  let return_val = [];

  try {
    for (let a of approval_request) {
      console.log(a);
      let action = await Approvals.find({ _id: a })
        .select("approver")
        .populate("approver")
        .exec();

      // && email enabled
      if (action[0].approver.email) {
        return_val.push(action[0].approver.email);
      }
    }

    return return_val;
  } catch (e) {
    return e;
  }
};

let sendMail = async (receiver, subject, link) => {
  let mailOptions = {
    from: "aspenforms@ke.betashelys.com",
    to: receiver,
    subject: subject,
    html:
      "<a href=`http://" + link + "`>Click here</a> to review approval request",
  };

  console.log(
    "<a href=`http://" + link + "`>Click here</a> to review approval request"
  );

  try {
    GmailService.transporter.sendMail(mailOptions, (err, data) => {
      if (err) {
        console.log(err);
        throw err;
      }
    });
  } catch (e) {}
};

exports.getDepartments = (req, res) => {
  Departments.find({}).exec((err, departments) => {
    if (err) {
      res.status(500).send({ message: err });
    } else {
      res.status(200).send(departments);
    }
  });
};

exports.createDepartment = (req, res) => {
  if (req.body.name) {
    Departments.create(req.body, (check_keys = false))
      .then(() => {
        res.status(200).send({ message: "Department created successfully!" });
      })
      .catch((e) => {
        res.status(500).send({ message: e });
      });
  } else {
    res.status(500).send({ message: "Invalid data!" });
  }
};

exports.createRole = (req, res) => {
  if (req.body.name && req.body.level) {
    Roles.create(req.body, (check_keys = false))
      .then(() => {
        res.status(200).send({ message: "Role created successfully!" });
      })
      .catch((e) => {
        res.status(500).send({ message: e });
      });
  } else {
    res.status(500).send({ message: "Invalid data!" });
  }
};

exports.updateRole = (req, res) => {
  if (req.body.id) {
    Roles.findByIdAndUpdate(
      req.body.id,
      {
        $set: {
          description: req.body.description,
          level: req.body.level,
          name: req.body.name,
          department: req.body.department,
        },
      },
      (err, resp) => {
        if (err) {
          res.status(500).send({ message: "Unable to update role!" });
        } else {
          res.status(200).send({ message: "Role successfully updated!" });
        }
      }
    );
  } else {
    res.status(500).send({ message: "Invalid data!" });
  }
};

exports.updateApprover = (req, res) => {
  if (req.body.id) {
    let body = {};
    if (req.body.password && req.body.password != "") {
      console.log(req.body.password);
      body = {
        username: req.body.username,
        firstname: req.body.firstname,
        lastname: req.body.lastname,
        password: bcrypt.hashSync(req.body.password, 8),
        role: req.body.role,
      };
    } else {
      body = {
        username: req.body.username,
        firstname: req.body.firstname,
        lastname: req.body.lastname,
        role: req.body.role,
      };
    }

    Approvers.findByIdAndUpdate(
      req.body.id,
      {
        $set: body,
      },
      (err, resp) => {
        if (err) {
          res.status(500).send({ message: "Unable to update user!" });
        } else {
          res.status(200).send({ message: "User successfully updated!" });
        }
      }
    );
  } else {
    res.status(500).send({ message: "Invalid data!" });
  }
};

exports.getFieldTypes = (req, res) => {
  Fields.find({}).exec((err, resp) => {
    if (err) {
      res.status(500).send({ message: err });
    } else {
      res.status(200).send(resp);
    }
  });
};

exports.updateForm = (req, res) => {
  Forms.findByIdAndUpdate(req.body.id, {
    $set: {
      name: req.body.name,
      fields: req.body.fields,
    },
  }).exec((err, resp) => {
    if (err) {
      res.status(500).send({ message: err });
    } else {
      res.status(200).send("Form updated!");
    }
  });
};

exports.createForm = (req, res) => {
  if (req.body) {
    Forms.create(req.body, (check_keys = false))
      .then(() => {
        res.status(200).send("Form creation successful!");
      })
      .catch((e) => {
        res.status(500).send({ message: e });
      });
  } else {
    res.status(500).send("Invalid Data!");
  }
};
