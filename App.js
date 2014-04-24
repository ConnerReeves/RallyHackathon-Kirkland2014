Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    
    layout: 'fit',
    items: [{
        xtype:'tabpanel',
        minTabWidth: 150,
        items:[{
            title: 'Permissions',
            layout: 'border',
            defaults: {
                layout: 'fit',
                resizable: true,
                collapsible: false
            },
            items: [{
                title: 'User Selection',
                id: 'userSelectionGridContainer',
                region: 'west',
                width: '50%',
                listeners: {
                    afterrender: function(panel) {
                        panel.header.add({
                            xtype     : 'textfield',
                            emptyText : 'User Search...',
                            width     : 200,
                            margin    : '0 0 0 0',
                            listeners : {
                                change : _.debounce(function(searchBox) {
                                    var searchText = searchBox.getValue();
                                    var grid = Ext.getCmp('userSelectionGrid');
                                    if (grid) {
                                        grid.store.filterBy(function(record) {
                                            return _.contains((record.get('FirstName') + record.get('LastName')).toLowerCase(), searchText.toLowerCase());
                                        });
                                    }
                                }, 250)
                            }
                        });
                    }
                }
            },
            {
                title: 'Project Selection',
                id: 'projectSelectionTreeContainer',
                region: 'center',
                width: '50%',
                header: {
                    height: 30
                }
            },
            {
                region: 'south',
                height: 28,
                resizable: false,
                layout: 'hbox',
                defaults: {
                    margin: '2 2 0 2'
                },
                items: [{
                    xtype: 'combobox',
                    id: 'permissionLevelPicker',
                    store: ['None', 'Viewer', 'Editor', 'Admin'],
                    value: 'Viewer',
                    width: 180,
                    fieldLabel: 'Permission Level',
                    labelWidth: 85
                },
                {
                    xtype: 'checkbox',
                    id: 'overwritePermissionsPicker',
                    fieldLabel: 'Overwrite Existing Permissions',
                    labelWidth: 155
                },
                {
                    xtype: 'checkbox',
                    id: 'includeChildProjectsPicker',
                    fieldLabel: 'Include Child Projects',
                    labelWidth: 106
                },
                {
                    xtype: 'component',
                    flex: 1
                },
                {
                    xtype: 'button',
                    text: 'Apply',
                    height: 22,
                    handler: function() {
                        Rally.getApp()._applyPermissions();
                    }
                }]
            }]
        }]
    }],
    
    launch: function() {
        Ext.getBody().mask('Loading');
        Deft.Chain.parallel([
            this._addUsersGrid,
            this._addProjectTree
        ]).then({
            success: function() {
                Ext.getBody().unmask();
            }
        });
    },
    
    _addUsersGrid: function () {
        var deferred = Ext.create('Deft.Deferred');
        Deft.Chain.pipeline([
            function () {
                var deferred = Ext.create('Deft.Deferred');
                Ext.create('Rally.data.WsapiDataStore', {
                    // limit   : Infinity,
                    model   : 'User',
                    fetch   : ['FirstName','LastName','Department'],
                    filters : [{
                        property: 'ObjectID',
                        operator: '>',
                        value: 0
                    },
                    {
                        property: 'FirstName',
                        operator: '!=',
                        value: null
                    },
                    {
                        property: 'LastName',
                        operator: '!=',
                        value: null
                    }],
                    sorters: [{
                        property: 'FirstName',
                        direction: 'ASC'
                    },
                    {
                        property: 'LastName',
                        direction: 'ASC'
                    }]
                }).load({
                    callback : function(records, operation, success) {
                        deferred.resolve(this);
                    }
                });
                return deferred.promise;
            },
            
            function (store) {
                Ext.getCmp('userSelectionGridContainer').add({
                    xtype: 'rallygrid',
                    id: 'userSelectionGrid',
                    store: store,
                    selModel: Ext.create('Ext.selection.CheckboxModel'),
                    columnCfgs: ['FirstName','LastName','Department'],
                    showPagingToolbar: false,
                    showRowActionsColumn: false
                });
            }
        ], this).then({
            success: function() {
                deferred.resolve();
            }
        });
        return deferred.promise;  
    },

    _addProjectTree: function() {
        var deferred = Ext.create('Deft.Deferred');
        Deft.Chain.pipeline([
            //Get Project Records from WSAPI
            function() {
                var deferred = Ext.create('Deft.Deferred');
                Ext.create('Rally.data.WsapiDataStore', {
                    limit : Infinity,
                    model : 'Project',
                    fetch : ['Parent','Name','ObjectID']
                }).load({
                    callback : function(records, operation, success) {
                        deferred.resolve(records);
                    }
                });
                return deferred.promise;
            },

            //Aggregate to tree store
            function(records) {
                //Initialize tree with top level projects
                var treeData = _.map(_.filter(records, function(record) {
                    return record.get('Parent') === null;
                }), function(record) {
                    return {
                        text: record.get('Name'),
                        id: record.get('ObjectID')
                    };
                });

                //Map parent OID to child records
                var parentChildMap = _.groupBy(_.filter(records, function(record) {
                    return record.get('Parent');
                }), function(record) {
                    return record.get('Parent').ObjectID;
                });

                this.populateChildren = function(parentNode) {
                    var childRecords = parentChildMap[parentNode.id];
                    if (childRecords && childRecords.length) {
                        parentNode.children = _.map(childRecords, function(childRecord) {
                            var childNode = {
                                text: childRecord.get('Name'),
                                id: childRecord.get('ObjectID')
                            };

                            this.populateChildren(childNode);

                            return childNode;
                        }, this);
                        parentNode.leaf = false;
                    } else {
                        parentNode.children = [];
                        parentNode.leaf = true;
                    }
                };


                _.each(treeData, function(rootNode) {
                    this.populateChildren(rootNode);
                }, this);

                return treeData;
            },

            function(treeData) {
                Ext.getCmp('projectSelectionTreeContainer').add({
                    xtype         : 'treepanel',
                    id            : 'projectSelectionTree',
                    allowDeselect : true,
                    // animate       : false,
                    multiSelect   : true,
                    rootVisible   : false,
                    store         : Ext.create('Ext.data.TreeStore', {
                        fields : ['children','id','text'],
                        root   : {
                            expanded : true,
                            children : treeData
                        }
                    })
                });
            }
        ], this).then({
            success: function() {
                deferred.resolve();
            }
        });
        return deferred.promise;
    },
    
    _applyPermissions: function() {
        var permissionLevel      = Ext.getCmp('permissionLevelPicker').getValue();
        var overwriteExisting    = Ext.getCmp('overwritePermissionsPicker').checked;
        var includeChildProjects = Ext.getCmp('includeChildProjectsPicker').checked;

        var selectedUserOIDs = _.map(Ext.getCmp('userSelectionGrid').getSelectionModel().getSelection(), function(record) {
            return record.get('ObjectID');
        });

        var selectedProjectOIDs = [];
        _.each(Ext.getCmp('projectSelectionTree').getSelectionModel().getSelection(), function(node) {
            if (includeChildProjects) {
                node.cascadeBy(function(child) {
                    selectedProjectOIDs.push(child.get('id'));
                });
            } else {
                selectedProjectOIDs.push(node.get('id'));
            }
        });   
    

        Deft.Chain.pipeline([
            function() {
                var deferred = Ext.create('Deft.Deferred');
                Ext.create('Rally.data.WsapiDataStore', {
                    limit   : Infinity,
                    model   : 'ProjectPermission',
                    fetch   : ['Role','Project','ObjectID','User'],
                    filters : Rally.data.QueryFilter.or(_.map(selectedUserOIDs, function(userOID) {
                        return {
                            property: 'User.ObjectID',
                            value: userOID
                        };
                    })),
                    listeners : {
                        beforeload : function() {
                            this.getProxy().actionMethods = {
                                read : 'POST'
                            };
                            this.getProxy().timeout = 600000; //10 minute timeout
                        }
                    }
                }).load({
                    callback : function(records, operation, success) {
                        deferred.resolve(_.indexBy(records, function(record) {
                            return record.get('User').ObjectID + '_' + record.get('Project').ObjectID;
                        }));
                    }
                });
                return deferred.promise;
            },

            function(userPermissionsMap) {
                var deferred = Ext.create('Deft.Deferred');
                
                Rally.data.ModelFactory.getModel({
                    type: 'ProjectPermission',
                    success: function(projectPermissionModel) {
                        var recordsToCreate = [];
                        var recordsToDelete = [];

                        _.each(selectedUserOIDs, function(userOID) {
                            _.each(selectedProjectOIDs, function(projectOID) {
                                var recordToUpdate = userPermissionsMap[userOID + '_' + projectOID];
                                if (!recordToUpdate) {
                                    recordsToCreate.push(Ext.create(projectPermissionModel, {
                                        User: '/user/' + userOID,
                                        Project: '/project/' + projectOID,
                                        Role: permissionLevel
                                    }));
                                } else if (recordToUpdate.get('Role') !== permissionLevel && overwriteExisting) {
                                    recordsToDelete.push(recordToUpdate);
                                    recordsToCreate.push(Ext.create(projectPermissionModel, {
                                        User: '/user/' + userOID,
                                        Project: '/project/' + projectOID,
                                        Role: permissionLevel
                                    }));
                                }
                            });
                        });
                        deferred.resolve({
                            recordsToCreate : recordsToCreate,
                            recordsToDelete : recordsToDelete
                        });
                    }
                });
                return deferred.promise;
            },

            function(recordSets) {
                console.log(recordSets);
                if (recordSets.recordsToCreate.length + recordSets.recordsToDelete.length > 0) {
                    this.add({
                        xtype: 'rallydialog',
                        id: 'dialog',
                        autoShow: true,
                        width: 500,
                        closable: true,
                        title: 'Updating Permissions...',
                        items: [{
                            xtype: 'progressbar',
                            id: 'updateProgress',
                            value: 0,
                            text: '0%',
                            failCount: 0,
                            totalCount: recordSets.recordsToCreate.length + recordSets.recordsToDelete.length,
                            finishedCount: 0,
                            incrimentCount: function() {
                                var percentRemaining = ++this.finishedCount / this.totalCount;
                                if (percentRemaining >= 1) {
                                    this.updateProgress(1, 'Successful: ' + Ext.util.Format.number((this.totalCount - this.failCount), '0,0') + ' Failed: ' + Ext.util.Format.number(this.failCount, '0,0'));
                                } else {
                                    this.updateProgress(percentRemaining, Math.round(percentRemaining * 100) + '%');
                                }
                            }
                        }],
                        listeners: {
                            close : function() {
                                this.destroy();
                            }
                        }
                    });

                    Deft.Chain.pipeline([
                        function() {
                            if (recordSets.recordsToDelete.length === 0) {
                                return [];
                            } else {
                                return this._processRecords(recordSets.recordsToDelete, 'destroy');
                            }
                        },
                        function(failedIds) {
                            recordSets.recordsToCreate = _.filter(recordSets.recordsToCreate, function(record) {
                                return !_.contains(failedIds, record.get('User').ObjectID + '_' + record.get('Project').ObjectID);
                            });

                            _.each(failedIds, function() {
                                Ext.getCmp('updateProgress').incrimentCount();
                            });

                            return this._processRecords(recordSets.recordsToCreate, 'save');
                        }
                    ], this).then({
                        success: function() {
                            
                        }
                    });
                } else {
                    Rally.ui.notify.Notifier.showWarning({
                        message  : 'No permissions to be changed.',
                        duration : 5000
                    });
                }
            }
        ], this);
    },

    _processRecords: function(records, method) {
        var deferred = Ext.create('Deft.Deferred');
        var failedRecords = [];
        Deft.Chain.sequence(_.map(records, function(record) {
            return function() {
                var deferred = Ext.create('Deft.Deferred');
                record[method]({
                    success: function() {
                        Ext.getCmp('updateProgress').incrimentCount();
                        deferred.resolve();
                    },
                    failure: function(record, err) {
                        console.log(err);
                        Ext.getCmp('updateProgress').failCount++;
                        Ext.getCmp('updateProgress').incrimentCount();
                        failedRecords.push(record);
                        deferred.resolve();
                    }
                });
                return deferred.promise;
            };
        })).then({
            success: function() {
                deferred.resolve(_.map(failedRecords, function(record) {
                    return record.get('User').ObjectID + '_' + record.get('Project').ObjectID;
                }));
            }
        });
        return deferred.promise;
    }
});